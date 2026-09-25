/**
 * Error responses over real HTTP (issue #8): the real GlobalFilter,
 * guards, ValidationPipe and RequestIdModule on the access harness, with
 * the real ProductService over a faked model and connection.
 */
import { Logger } from '@nestjs/common';
import { Connection, mongo, Model } from 'mongoose';
import { Role } from '../../auth/types';
import { ErrorCode } from '../errors';
import {
    AccessHarness,
    bootAccessHarness,
    caller,
} from '../testing/access-harness';
import { ProductController } from '../../product/product.controller';
import { ProductService } from '../../product/product.service';
import { Product } from '../../product/product.schema';
import { InventoryService } from '../../inventory-man/inventory/inventory.service';
import { EanCounterService } from '../../ean-counter/ean-counter.service';
import { INTERNAL_MESSAGE } from './global.filter';

const DUP_MSG =
    'E11000 duplicate key error collection: pos.products index: name_1 dup key: { name: "milk" }';

/** What `insertMany` throws for a clashing name (see the driver). */
function bulkDuplicate() {
    return new mongo.MongoBulkWriteError(
        {
            message: DUP_MSG,
            code: 11000,
            writeErrors: [
                {
                    err: {
                        index: 0,
                        code: 11000,
                        errmsg: DUP_MSG,
                        op: { name: 'milk', price: 1999, EAN: '2000000000015' },
                    },
                    get code() {
                        return 11000;
                    },
                    get index() {
                        return 0;
                    },
                },
            ] as never,
        },
        { insertedCount: 0 } as never,
    );
}

describe('Error responses (e2e, issue #8)', () => {
    let harness: AccessHarness;
    let errorLog: jest.SpyInstance;
    let warnLog: jest.SpyInstance;
    const insertMany = jest.fn();
    const findOne = jest.fn();
    const inventoryCreateMany = jest.fn().mockResolvedValue(undefined);

    const connection = {
        startSession: () =>
            Promise.resolve({
                withTransaction: async (fn: (s: unknown) => unknown) => {
                    await fn({});
                },
                endSession: () => Promise.resolve(),
            }),
    } as unknown as Connection;

    const service = new ProductService(
        connection,
        { insertMany, findOne } as unknown as Model<Product>,
        { createMany: inventoryCreateMany } as unknown as InventoryService,
        {} as EanCounterService,
    );

    const restocker = caller(Role.Restocker);
    const newProducts = {
        newProducts: [{ EAN: '2000000000015', name: 'Milk', price: 1999 }],
    };

    beforeAll(async () => {
        harness = await bootAccessHarness(
            [ProductController],
            [{ provide: ProductService, useValue: service }],
        );
    });

    afterAll(async () => {
        await harness.close();
    });

    beforeEach(() => {
        errorLog = jest
            .spyOn(Logger.prototype, 'error')
            .mockImplementation(() => undefined);
        warnLog = jest
            .spyOn(Logger.prototype, 'warn')
            .mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        insertMany.mockReset();
        findOne.mockReset();
    });

    it('answers a duplicate product name in POST /products/bulk with 400 DB_DUPLICATE_KEY', async () => {
        insertMany.mockRejectedValue(bulkDuplicate());

        const res = await harness.call(
            restocker,
            'POST',
            '/products/bulk',
            newProducts,
        );
        const body = (await res.json()) as Record<string, unknown>;

        expect(res.status).toBe(400);
        expect(body).toMatchObject({
            statusCode: 400,
            error: ErrorCode.DB_DUPLICATE_KEY,
            details: [{ msg: 'Already exists', property: 'name', index: 0 }],
            requestId: res.headers.get('x-request-id'),
        });
        const json = JSON.stringify(body);
        expect(json).not.toContain('E11000');
        expect(json).not.toContain('"op"');
        expect(json).not.toContain('1999');
        expect(inventoryCreateMany).not.toHaveBeenCalled();

        // A 4xx, so a warning, but with the stack and the driver error.
        expect(errorLog).not.toHaveBeenCalled();
        expect(warnLog).toHaveBeenCalledTimes(1);
        const entry = warnLog.mock.calls[0][0] as string;
        expect(entry).toContain(
            `[${String(body.requestId)}] POST /v1/products/bulk -> 400 DB_002`,
        );
        expect(entry).toContain('\n    at ');
        expect(entry).toContain('Caused by: MongoBulkWriteError');
    });

    it('answers an oversized body with 413, not a 500', async () => {
        const res = await harness.call(restocker, 'POST', '/products/bulk', {
            newProducts: [
                {
                    name: 'Milk',
                    price: 1999,
                    padding: 'x'.repeat(200 * 1024),
                },
            ],
        });
        const body = (await res.json()) as Record<string, unknown>;

        expect(res.status).toBe(413);
        expect(body).toMatchObject({
            statusCode: 413,
            error: ErrorCode.HTTP_ERROR,
            message: 'request entity too large',
            details: null,
            requestId: res.headers.get('x-request-id'),
        });
        expect(insertMany).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
        expect(warnLog).toHaveBeenCalledTimes(1);
    });

    it('answers malformed JSON with 400 VALIDATION_INVALID_INPUT, not a 500', async () => {
        // body-parser rejects it before any guard runs, so no caller.
        const res = await fetch(
            `${await harness.app.getUrl()}/v1/products/bulk`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{"newProducts": [',
            },
        );

        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe(
            ErrorCode.VALIDATION_INVALID_INPUT,
        );
        expect(errorLog).not.toHaveBeenCalled();
    });

    it('answers an unexpected failure with a generic 500, echoes the request id and logs the stack', async () => {
        findOne.mockReturnValue({
            lean: () =>
                Promise.reject(
                    new Error('lost connection to mongodb://pos:hunter2@db'),
                ),
        });

        const res = await harness.call(
            restocker,
            'GET',
            '/products/2000000000015',
            undefined,
            { 'X-Request-Id': 'till-3.req-42' },
        );
        const body = (await res.json()) as Record<string, unknown>;

        expect(res.status).toBe(500);
        expect(res.headers.get('x-request-id')).toBe('till-3.req-42');
        expect(body).toEqual({
            statusCode: 500,
            error: ErrorCode.INTERNAL_ERROR,
            message: INTERNAL_MESSAGE,
            timestamp: expect.any(String),
            path: '/v1/products/2000000000015',
            details: null,
            requestId: 'till-3.req-42',
        });
        expect(JSON.stringify(body)).not.toContain('hunter2');

        expect(errorLog).toHaveBeenCalledTimes(1);
        const [line, stack] = errorLog.mock.calls[0] as [string, string];
        expect(line).toContain(
            '[till-3.req-42] GET /v1/products/2000000000015 -> 500',
        );
        expect(stack).toContain('lost connection');
        expect(stack).toContain('\n    at ');
    });

    it('sets a generated X-Request-Id on successful responses too', async () => {
        findOne.mockReturnValue({
            lean: () => Promise.resolve({ EAN: '2000000000015' }),
        });

        const res = await harness.call(
            restocker,
            'GET',
            '/products/2000000000015',
        );

        expect(res.status).toBe(200);
        expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('replaces an unsafe incoming X-Request-Id', async () => {
        findOne.mockReturnValue({
            lean: () => Promise.resolve({ EAN: '2000000000015' }),
        });

        const res = await harness.call(
            restocker,
            'GET',
            '/products/2000000000015',
            undefined,
            { 'X-Request-Id': 'x'.repeat(200) },
        );

        expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('answers a role denial with 403 FORBIDDEN, not a validation error', async () => {
        const res = await harness.call(
            caller(Role.Seller),
            'POST',
            '/products/bulk',
            newProducts,
        );
        const body = (await res.json()) as Record<string, unknown>;

        expect(res.status).toBe(403);
        expect(body.error).toBe(ErrorCode.FORBIDDEN);
        expect(body.requestId).toBe(res.headers.get('x-request-id'));
    });

    it('answers an unknown route with 404 NOT_FOUND', async () => {
        const res = await harness.call(restocker, 'GET', '/nope');
        const body = (await res.json()) as Record<string, unknown>;

        expect(res.status).toBe(404);
        expect(body.error).toBe(ErrorCode.NOT_FOUND);
        expect(typeof body.requestId).toBe('string');
    });

    it('answers a ValidationPipe failure with 400 VALIDATION_INVALID_INPUT and the messages', async () => {
        const res = await harness.call(restocker, 'POST', '/products/bulk', {
            newProducts: [{ name: 'Milk', price: -1 }],
        });
        const body = (await res.json()) as {
            error: string;
            message: string;
            details: { messages: string[] };
        };

        expect(res.status).toBe(400);
        expect(body.error).toBe(ErrorCode.VALIDATION_INVALID_INPUT);
        expect(body.details.messages.length).toBeGreaterThan(0);
        expect(body.message).toBe(body.details.messages.join(', '));
    });
});
