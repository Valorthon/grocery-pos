import type { NextFunction, Request, Response } from 'express';
import { bodyParserFailure, withSafeErrors } from './body-parsers';
import { stackWithCauses } from './global/global.filter';

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

    it('keeps no cause on a 4xx: its message is the client input', () => {
        const failure = bodyParserFailure(
            Object.assign(new Error('bad "hunter2"'), {
                status: 415,
                expose: true,
            }),
        );
        expect(failure.cause).toBeUndefined();
        expect(stackWithCauses(failure)).not.toContain('hunter2');
    });

    it.each([
        ['stream.encoding.set', 500],
        ['stream.not.readable', 500],
        ['an unknown failure', undefined],
    ])(
        'keeps a 5xx (%s) original as a non-enumerable cause, logged by stackWithCauses (#108)',
        (type, status) => {
            const original = Object.assign(
                new Error(`internal ${type} detail`),
                { status, expose: false, type },
            );
            const failure = bodyParserFailure(original);

            expect(failure.status).toBe(500);
            expect(failure.message).toBe('Request body refused');
            expect(failure.cause).toBe(original);
            expect(Object.keys(failure)).not.toContain('cause');
            expect(JSON.stringify(failure)).not.toContain('detail');
            expect(stackWithCauses(failure)).toContain(
                `Caused by: Error: internal ${type} detail`,
            );
        },
    );

    it('keeps a non-Error 5xx cause as it is', () => {
        expect(bodyParserFailure('boom').cause).toBe('boom');
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
