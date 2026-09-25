import {
    ArgumentsHost,
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    HttpStatus,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    PayloadTooLargeException,
    UnauthorizedException,
    ValidationPipe,
} from '@nestjs/common';
import { Error as MongooseError, mongo } from 'mongoose';
import { IsInt, IsString, Min } from 'class-validator';
import { GlobalFilter, INTERNAL_MESSAGE } from './global.filter';
import { JWTInvalidError } from '../../auth/types';
import {
    AppError,
    AuthError,
    ConflictError,
    ErrorCode,
    classifyDbError,
    InternalError,
    RateLimitError,
    ValidationError,
} from '../errors';

function hostFor(url: string, headers: Record<string, string> = {}) {
    const res = {
        headersSent: false,
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
    const req: Record<string, unknown> = {
        url,
        originalUrl: url,
        method: 'POST',
        headers,
    };
    const host = {
        switchToHttp: () => ({
            getResponse: () => res,
            getRequest: () => req,
        }),
    } as unknown as ArgumentsHost;
    return { host, res, req };
}

/** The JSON body the filter sent. */
function bodyOf(res: { json: jest.Mock }): Record<string, unknown> {
    return res.json.mock.calls[0][0] as Record<string, unknown>;
}

let errorLog: jest.SpyInstance;
let warnLog: jest.SpyInstance;

beforeEach(() => {
    errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    warnLog = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('GlobalFilter on auth errors', () => {
    const filter = new GlobalFilter();

    it.each([
        [
            'an expired access token',
            new JWTInvalidError(ErrorCode.AUTH_TOKEN_EXPIRED),
            ErrorCode.AUTH_TOKEN_EXPIRED,
        ],
        [
            'a missing or bad access token',
            new JWTInvalidError(),
            ErrorCode.AUTH_INVALID_TOKEN,
        ],
        [
            'a missing refresh cookie',
            new AuthError(ErrorCode.AUTH_MISSING_REFRESH_TOKEN, 'x'),
            ErrorCode.AUTH_MISSING_REFRESH_TOKEN,
        ],
        [
            'bad login credentials',
            new AuthError(ErrorCode.AUTH_INVALID_CREDENTIALS, 'x'),
            ErrorCode.AUTH_INVALID_CREDENTIALS,
        ],
    ])('answers %s with 401', (_label, exception, code) => {
        const { host, res } = hostFor('/v1/sales');

        filter.catch(exception, host);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                statusCode: 401,
                error: code,
                path: '/v1/sales',
            }),
        );
    });

    it('still answers an unknown error with 500', () => {
        const { host, res } = hostFor('/v1/sales');

        filter.catch(new Error('boom'), host);

        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe('GlobalFilter on rate limiting', () => {
    it('answers a RateLimitError with an AppError-shaped 429', () => {
        const { host, res } = hostFor('/v1/auth/login');

        new GlobalFilter().catch(
            new RateLimitError('Too many attempts', { retryAfterS: 60 }),
            host,
        );

        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                statusCode: 429,
                error: ErrorCode.RATE_LIMITED,
                path: '/v1/auth/login',
                details: { retryAfterS: 60 },
            }),
        );
    });
});

describe('GlobalFilter on shift errors (issue #2)', () => {
    const filter = new GlobalFilter();

    it.each([
        ErrorCode.SHIFT_NOT_OPEN,
        ErrorCode.SHIFT_ALREADY_OPEN,
        ErrorCode.SHIFT_CLOSED,
        ErrorCode.SHIFT_PAYOUT_REQUIRED,
        ErrorCode.SHIFT_PAYOUT_NO_OPEN_SHIFT,
    ])('answers %s with 409 and the code', (code) => {
        const { host, res } = hostFor('/v1/shifts');

        filter.catch(new ConflictError(code, 'x'), host);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: 409, error: code }),
        );
    });
});

/**
 * Mirrors the driver's `WriteError` (mongodb/lib/bulk/common.js): the raw
 * server write error, including `op` (the attempted document), sits in
 * `err`; `code`, `index` and `errmsg` are getters over it.
 */
class DriverWriteError {
    constructor(public readonly err: Record<string, unknown>) {}
    get code() {
        return this.err.code;
    }
    get index() {
        return this.err.index;
    }
    get errmsg() {
        return this.err.errmsg;
    }
}

const DUP_MSG =
    'E11000 duplicate key error collection: pos.products index: name_1 dup key: { name: "Secret Milk" }';

/** A real driver `MongoServerError`, as `create` / `updateOne` throw it. */
function serverDuplicate() {
    return new mongo.MongoServerError({
        message: DUP_MSG,
        errmsg: DUP_MSG,
        code: 11000,
        keyPattern: { name: 1 },
        keyValue: { name: 'Secret Milk' },
    });
}

/** A real driver `MongoBulkWriteError`, as `insertMany` throws it. */
function bulkDuplicate() {
    return new mongo.MongoBulkWriteError(
        {
            message: DUP_MSG,
            code: 11000,
            writeErrors: [
                new DriverWriteError({
                    index: 1,
                    code: 11000,
                    errmsg: DUP_MSG,
                    op: { name: 'Secret Milk', price: 4200, EAN: '200' },
                }),
            ] as never,
        },
        { insertedCount: 1 } as never,
    );
}

/** No driver payload, attempted document or value in a response body. */
function expectNoInternals(body: Record<string, unknown>) {
    const json = JSON.stringify(body);
    for (const leak of [
        'Secret Milk',
        'E11000',
        '"op"',
        '4200',
        'stack',
        'keyValue',
    ]) {
        expect(json).not.toContain(leak);
    }
}

describe('GlobalFilter on duplicate keys (issue #8)', () => {
    const filter = new GlobalFilter();

    it.each([
        ['a MongoServerError', serverDuplicate],
        ['a MongoBulkWriteError', bulkDuplicate],
        [
            // What runInTransaction throws: the classified AppError, with
            // the driver error as its cause.
            'a MongoServerError classified by a transaction',
            () => classifyDbError(serverDuplicate())!,
        ],
        [
            'a MongoBulkWriteError classified by a transaction',
            () => classifyDbError(bulkDuplicate())!,
        ],
    ])(
        'answers %s with 400 DB_DUPLICATE_KEY and no driver payload',
        (_label, make) => {
            const { host, res } = hostFor('/v1/products/bulk');

            filter.catch(make(), host);

            expect(res.status).toHaveBeenCalledWith(400);
            const body = bodyOf(res);
            expect(body).toMatchObject({
                statusCode: 400,
                error: ErrorCode.DB_DUPLICATE_KEY,
                message: 'Already exists',
            });
            expect(body.details).toEqual([
                expect.objectContaining({
                    msg: 'Already exists',
                    property: 'name',
                }),
            ]);
            expectNoInternals(body);
            expect(errorLog).not.toHaveBeenCalled();
        },
    );

    it('names the clashing document of a bulk insert by index only', () => {
        const { host, res } = hostFor('/v1/products/bulk');

        filter.catch(bulkDuplicate(), host);

        expect(bodyOf(res).details).toEqual([
            { msg: 'Already exists', property: 'name', index: 1 },
        ]);
    });

    it('dispatches on the code, not the error name', () => {
        const { host, res } = hostFor('/v1/x');
        const err = Object.assign(new Error('dup'), {
            name: 'MongoWriteConcernError',
            code: 11000,
            keyPattern: { EAN: 1 },
        });

        filter.catch(err, host);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(bodyOf(res).details).toEqual([
            { msg: 'Already exists', property: 'EAN' },
        ]);
    });
});

describe('GlobalFilter on Mongoose validation (issue #8)', () => {
    const filter = new GlobalFilter();

    it('answers a ValidationError with 400 DB_VALIDATION_ERROR per field', () => {
        const err = new MongooseError.ValidationError();
        err.addError(
            'price',
            // A `validate` message written in our schema.
            new MongooseError.ValidatorError({
                path: 'price',
                message: 'price must be an integer',
                type: 'user defined',
                value: 1.5,
            }),
        );
        const { host, res } = hostFor('/v1/products');

        filter.catch(err, host);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(bodyOf(res)).toMatchObject({
            error: ErrorCode.DB_VALIDATION_ERROR,
            details: [{ field: 'price', message: 'price must be an integer' }],
        });
    });

    it('answers a CastError with 400 DB_VALIDATION_ERROR, without the value', () => {
        const err = new MongooseError.CastError(
            'ObjectId',
            'not-an-id-secret',
            '_id',
        );
        const { host, res } = hostFor('/v1/sales/x');

        filter.catch(err, host);

        expect(res.status).toHaveBeenCalledWith(400);
        const body = bodyOf(res);
        expect(body).toMatchObject({
            error: ErrorCode.DB_VALIDATION_ERROR,
            details: [{ field: '_id', message: 'Invalid value' }],
        });
        const json = JSON.stringify(body);
        expect(json).not.toContain('not-an-id-secret');
        expect(json).not.toContain('Cast to');
        // The raw message stays in the log.
        expect(warnLog.mock.calls[0][0]).toContain('not-an-id-secret');
    });

    it("hides Mongoose's built-in messages, which echo the value", () => {
        const err = new MongooseError.ValidationError();
        err.addError(
            'price',
            new MongooseError.ValidatorError({
                path: 'price',
                message:
                    'Path `price` (-4242) is less than minimum allowed value (0).',
                type: 'min',
                value: -4242,
            }),
        );
        err.addError(
            'shift',
            new MongooseError.CastError(
                'ObjectId',
                'nope-secret',
                'shift',
                new Error('BSONError: input must be a 24 character hex string'),
            ),
        );
        const { host, res } = hostFor('/v1/sales');

        filter.catch(err, host);

        const body = bodyOf(res);
        expect(body.details).toEqual([
            { field: 'price', message: 'Invalid value' },
            { field: 'shift', message: 'Invalid value' },
        ]);
        const json = JSON.stringify(body);
        for (const leak of ['-4242', 'nope-secret', 'BSON', 'minimum']) {
            expect(json).not.toContain(leak);
        }
    });

    it('does not mistake the app ValidationError for a Mongoose one', () => {
        const err = new ValidationError(
            ErrorCode.VALIDATION_INVALID_INPUT,
            'Insufficient stock',
            [{ product: 'p1', requested: 5, available: 1 }],
        );
        const { host, res } = hostFor('/v1/sales');

        filter.catch(err, host);

        expect(bodyOf(res)).toMatchObject({
            statusCode: 400,
            error: ErrorCode.VALIDATION_INVALID_INPUT,
            details: [{ product: 'p1', requested: 5, available: 1 }],
        });
    });
});

describe('GlobalFilter on HttpExceptions (issue #8)', () => {
    const filter = new GlobalFilter();

    it.each([
        [new UnauthorizedException(), 401, ErrorCode.AUTH_INVALID_TOKEN],
        [new ForbiddenException(), 403, ErrorCode.FORBIDDEN],
        [
            new NotFoundException('Cannot GET /v1/nope'),
            404,
            ErrorCode.NOT_FOUND,
        ],
        [new ConflictException(), 409, ErrorCode.CONFLICT],
        [
            new HttpException(
                'Too Many Requests',
                HttpStatus.TOO_MANY_REQUESTS,
            ),
            429,
            ErrorCode.RATE_LIMITED,
        ],
        [new PayloadTooLargeException(), 413, ErrorCode.HTTP_ERROR],
    ])(
        'keeps the status of %s with a matching code',
        (exception, status, code) => {
            const { host, res } = hostFor('/v1/x');

            filter.catch(exception, host);

            expect(res.status).toHaveBeenCalledWith(status);
            expect(bodyOf(res)).toMatchObject({
                statusCode: status,
                error: code,
            });
            expect(bodyOf(res).error).not.toBe(
                ErrorCode.VALIDATION_INVALID_INPUT,
            );
            expect(errorLog).not.toHaveBeenCalled();
            expect(warnLog).toHaveBeenCalledTimes(1);
        },
    );

    it('keeps the message of a 404', () => {
        const { host, res } = hostFor('/v1/nope');

        filter.catch(new NotFoundException('Cannot GET /v1/nope'), host);

        expect(bodyOf(res).message).toBe('Cannot GET /v1/nope');
    });

    it('answers the ValidationPipe 400 with VALIDATION_INVALID_INPUT and the messages', async () => {
        class Dto {
            @IsString()
            name!: string;

            @IsInt()
            @Min(1)
            quantity!: number;
        }
        const exception = await new ValidationPipe()
            .transform({ quantity: 0 }, { type: 'body', metatype: Dto })
            .then(
                () => {
                    throw new Error('expected a rejection');
                },
                (e: unknown) => e,
            );
        expect(exception).toBeInstanceOf(BadRequestException);
        const { host, res } = hostFor('/v1/x');

        filter.catch(exception, host);

        expect(res.status).toHaveBeenCalledWith(400);
        const body = bodyOf(res);
        const messages = (body.details as { messages: string[] }).messages;
        expect(body.error).toBe(ErrorCode.VALIDATION_INVALID_INPUT);
        expect(messages).toEqual(
            expect.arrayContaining([
                'name must be a string',
                'quantity must not be less than 1',
            ]),
        );
        expect(body.message).toBe(messages.join(', '));
    });

    it('answers a 5xx HttpException generically and logs it', () => {
        const { host, res } = hostFor('/v1/x');

        filter.catch(
            new InternalServerErrorException('db password in here'),
            host,
        );

        expect(bodyOf(res)).toMatchObject({
            statusCode: 500,
            error: ErrorCode.INTERNAL_ERROR,
            message: INTERNAL_MESSAGE,
            details: null,
        });
        expect(errorLog).toHaveBeenCalledTimes(1);
    });
});

describe('GlobalFilter on unexpected errors (issue #8)', () => {
    const filter = new GlobalFilter();

    it('answers a plain Error with a generic 500 and logs the stack with the request id', () => {
        const { host, res } = hostFor('/v1/sales?name=milk', {
            'x-request-id': 'req-abc.123',
        });
        const boom = new Error('connection string mongodb://user:pw@host');

        filter.catch(boom, host);

        expect(res.status).toHaveBeenCalledWith(500);
        const body = bodyOf(res);
        expect(body).toMatchObject({
            statusCode: 500,
            error: ErrorCode.INTERNAL_ERROR,
            message: INTERNAL_MESSAGE,
            details: null,
            requestId: 'req-abc.123',
        });
        expect(JSON.stringify(body)).not.toContain('mongodb://');
        expect(res.setHeader).toHaveBeenCalledWith(
            'X-Request-Id',
            'req-abc.123',
        );

        expect(errorLog).toHaveBeenCalledTimes(1);
        const [line, stack] = errorLog.mock.calls[0] as [string, string];
        expect(line).toContain('[req-abc.123]');
        expect(line).toContain('POST /v1/sales -> 500');
        expect(line).not.toContain('name=milk');
        expect(stack).toBe(boom.stack);
    });

    it('logs the cause of a wrapped error but never sends it', () => {
        const cause = Object.assign(new Error('WriteConflict'), {
            name: 'MongoServerError',
            code: 112,
        });
        const wrapped = new InternalError(
            'Transaction failed',
            { secret: 'internal-detail' },
            { cause },
        );
        const { host, res } = hostFor('/v1/sales');

        filter.catch(wrapped, host);

        const body = bodyOf(res);
        expect(body).toMatchObject({
            statusCode: 500,
            error: ErrorCode.INTERNAL_ERROR,
            details: null,
        });
        expect(JSON.stringify(body)).not.toContain('WriteConflict');
        expect(JSON.stringify(body)).not.toContain('internal-detail');

        const [line, stack] = errorLog.mock.calls[0] as [string, string];
        expect(line).toContain('internal-detail');
        expect(stack).toContain(wrapped.stack);
        expect(stack).toContain(`Caused by: ${cause.stack}`);
    });

    it('generates a request id when the incoming one is not sane', () => {
        const { host, res } = hostFor('/v1/x', {
            'x-request-id': 'bad id\nwith newline',
        });

        filter.catch(new Error('boom'), host);

        const id = bodyOf(res).requestId as string;
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', id);
    });

    it('reuses the id the middleware already assigned', () => {
        const { host, res, req } = hostFor('/v1/x');
        req.requestId = 'from-middleware';

        filter.catch(new Error('boom'), host);

        expect(bodyOf(res).requestId).toBe('from-middleware');
        expect(res.setHeader).not.toHaveBeenCalled();
    });
});

describe('GlobalFilter on AppErrors (issue #8)', () => {
    const filter = new GlobalFilter();

    it('sends an AppError unchanged, with its details, and does not log it as an error', () => {
        const err = new ConflictError(
            ErrorCode.SHIFT_PAYOUT_REQUIRED,
            'Choose a shift to pay from',
            { openShifts: 2 },
        );
        const { host, res } = hostFor('/v1/sales/s1/void');

        filter.catch(err, host);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(bodyOf(res)).toEqual({
            statusCode: 409,
            error: ErrorCode.SHIFT_PAYOUT_REQUIRED,
            message: 'Choose a shift to pay from',
            timestamp: expect.any(String),
            path: '/v1/sales/s1/void',
            details: { openShifts: 2 },
            requestId: expect.any(String),
        });
        expect(errorLog).not.toHaveBeenCalled();
        expect(warnLog).toHaveBeenCalledTimes(1);
    });

    it('keeps a 5xx AppError message but drops its details', () => {
        const err = new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            'Restock was not applied to every product',
            { expected: 3, matched: 2 },
        );
        const { host, res } = hostFor('/v1/restocks');

        filter.catch(err, host);

        expect(bodyOf(res)).toMatchObject({
            message: 'Restock was not applied to every product',
            details: null,
        });
        expect(errorLog).toHaveBeenCalledTimes(1);
    });
});

describe('GlobalFilter on body-parser (http-errors) client errors (issue #8)', () => {
    const filter = new GlobalFilter();

    /** The shape `http-errors` gives body-parser's errors. */
    function httpError(
        status: number,
        name: string,
        message: string,
        extra: Record<string, unknown> = {},
    ) {
        return Object.assign(new Error(message), {
            name,
            status,
            statusCode: status,
            expose: status < 500,
            ...extra,
        });
    }

    it.each([
        [
            httpError(413, 'PayloadTooLargeError', 'request entity too large', {
                type: 'entity.too.large',
                limit: 102400,
                length: 204800,
            }),
            413,
            ErrorCode.HTTP_ERROR,
        ],
        [
            httpError(400, 'SyntaxError', 'Unexpected token } in JSON', {
                type: 'entity.parse.failed',
                body: '{"password":"hunter2"}',
            }),
            400,
            ErrorCode.VALIDATION_INVALID_INPUT,
        ],
        [
            httpError(
                415,
                'UnsupportedMediaTypeError',
                'unsupported charset "X"',
            ),
            415,
            ErrorCode.HTTP_ERROR,
        ],
    ])('keeps the status of an exposed %#', (err, status, code) => {
        const { host, res } = hostFor('/v1/products/bulk');

        filter.catch(err, host);

        expect(res.status).toHaveBeenCalledWith(status);
        const body = bodyOf(res);
        expect(body).toMatchObject({
            statusCode: status,
            error: code,
            message: err.message,
            details: null,
        });
        expect(JSON.stringify(body)).not.toContain('hunter2');
        expect(errorLog).not.toHaveBeenCalled();
        expect(warnLog).toHaveBeenCalledTimes(1);
        expect(warnLog.mock.calls[0][0]).not.toContain('hunter2');
    });

    it('keeps a non-exposed or 5xx http error a generic 500', () => {
        for (const err of [
            httpError(400, 'BadRequestError', 'secret', { expose: false }),
            httpError(503, 'ServiceUnavailableError', 'secret'),
            httpError(503, 'ServiceUnavailableError', 'secret', {
                expose: true,
            }),
        ]) {
            const { host, res } = hostFor('/v1/x');

            filter.catch(err, host);

            expect(bodyOf(res)).toMatchObject({
                statusCode: 500,
                message: INTERNAL_MESSAGE,
            });
        }
    });
});

describe('GlobalFilter logs classified database errors with the stack (issue #8)', () => {
    const filter = new GlobalFilter();

    it('warns with the stack and cause chain for a duplicate from a transaction', () => {
        const driver = serverDuplicate();
        const { host } = hostFor('/v1/products/bulk');

        filter.catch(classifyDbError(driver)!, host);

        expect(errorLog).not.toHaveBeenCalled();
        expect(warnLog).toHaveBeenCalledTimes(1);
        const entry = warnLog.mock.calls[0][0] as string;
        expect(entry).toContain('-> 400 DB_002');
        expect(entry).toContain(`Caused by: ${driver.stack}`);
    });

    it('warns with the stack for a raw duplicate outside a transaction', () => {
        const driver = serverDuplicate();
        const { host } = hostFor('/v1/users');

        filter.catch(driver, host);

        expect(warnLog.mock.calls[0][0]).toContain(driver.stack);
    });

    it('keeps other 4xx to one line', () => {
        const { host } = hostFor('/v1/x');

        filter.catch(new ForbiddenException(), host);

        expect(warnLog.mock.calls[0][0]).not.toContain('\n');
    });
});
