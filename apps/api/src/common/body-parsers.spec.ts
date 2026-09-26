import type { NextFunction, Request, Response } from 'express';
import { bodyParserFailure, withSafeErrors } from './body-parsers';

describe('bodyParserFailure (#94)', () => {
    it('keeps status, expose and type, never the message or cause', () => {
        const source = Object.assign(
            new SyntaxError('Unexpected token in {"password":"hunter2"}'),
            {
                status: 400,
                expose: true,
                type: 'entity.parse.failed',
                body: 'hunter2',
            },
        );
        const failure = bodyParserFailure(source);

        expect(failure).not.toBeInstanceOf(SyntaxError);
        expect(failure).toMatchObject({
            name: 'BodyParserError',
            message: 'Request body refused',
            status: 400,
            statusCode: 400,
            expose: true,
            type: 'entity.parse.failed',
        });
        expect(failure.cause).toBeUndefined();
        expect(
            JSON.stringify({ ...failure, stack: failure.stack }),
        ).not.toContain('hunter2');
    });

    it.each([
        ['a 5xx', { status: 500, expose: true }, 500, false],
        ['statusCode only', { statusCode: 415, expose: true }, 415, true],
        ['no status', { expose: true }, 500, false],
        ['a 3xx', { status: 302, expose: true }, 500, false],
        ['not exposed', { status: 400, expose: false }, 400, false],
        ['not an object', 'boom', 500, false],
        ['null', null, 500, false],
    ])('%s', (_label, err, status, expose) => {
        const failure = bodyParserFailure(err);
        expect(failure.status).toBe(status);
        expect(failure.expose).toBe(expose);
        expect(failure.type).toBeUndefined();
    });
});

describe('withSafeErrors (#94)', () => {
    const req = {} as Request;
    const res = {} as Response;

    it('passes success straight on', () => {
        const next = jest.fn();
        withSafeErrors((_q, _s, n) => n())(req, res, next as NextFunction);
        expect(next).toHaveBeenCalledWith();
    });

    it('passes a failure on as a bodyParserFailure', () => {
        const next = jest.fn();
        withSafeErrors((_q, _s, n) =>
            n(
                Object.assign(new Error('unsupported charset "X"'), {
                    status: 415,
                    expose: true,
                    type: 'charset.unsupported',
                }),
            ),
        )(req, res, next as NextFunction);
        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Request body refused',
                status: 415,
                type: 'charset.unsupported',
            }),
        );
    });
});
