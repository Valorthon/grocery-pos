import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestIdMiddleware } from '../request-id/request-id';
import { TimingMiddleware, pathOf } from './timing.middleware';

function fakeRequest(
    originalUrl: string,
    headers: Record<string, string> = {},
): Request {
    return { method: 'GET', originalUrl, url: originalUrl, headers } as never;
}

function fakeResponse(): Response & EventEmitter {
    const res = new EventEmitter() as Response & EventEmitter;
    const headers: Record<string, string> = {};
    Object.assign(res, {
        statusCode: 200,
        headersSent: false,
        setHeader: (name: string, value: string) => {
            headers[name.toLowerCase()] = value;
        },
        getHeader: (name: string) => headers[name.toLowerCase()],
    });
    return res;
}

describe('TimingMiddleware (#16)', () => {
    let log: jest.SpyInstance;

    beforeEach(() => {
        log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    });

    afterEach(() => {
        log.mockRestore();
    });

    function run(req: Request, res: Response & EventEmitter) {
        const next: NextFunction = jest.fn();
        TimingMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        res.emit('finish');
        res.emit('close');
        return log.mock.calls.map(([line]) => String(line));
    }

    it('logs the path without the query string, once', () => {
        const lines = run(
            fakeRequest(
                '/v1/products?name=secret%20item&EAN=480&page=1&limit=5',
                { 'x-request-id': 'till-3.req-42' },
            ),
            fakeResponse(),
        );

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(
            /^\[GET\] \/v1\/products - 200 - \d+\.\d{2}ms - till-3\.req-42$/,
        );
        expect(lines[0]).not.toContain('secret');
        expect(lines[0]).not.toContain('?');
    });

    it('logs the same request id RequestIdMiddleware gives the response', () => {
        const req = fakeRequest('/v1/sales?page=1&limit=5');
        const res = fakeResponse();
        RequestIdMiddleware(req, res, jest.fn());

        const [line] = run(req, res);
        const id = res.getHeader('X-Request-Id') as string;

        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(line.endsWith(` - ${id}`)).toBe(true);
    });

    it('assigns the id itself if it runs first, and RequestIdMiddleware keeps it', () => {
        const req = fakeRequest('/v1/sales');
        const res = fakeResponse();
        TimingMiddleware(req, res, jest.fn());
        RequestIdMiddleware(req, res, jest.fn());
        res.emit('finish');

        const id = res.getHeader('X-Request-Id') as string;
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(String(log.mock.calls[0][0]).endsWith(` - ${id}`)).toBe(true);
    });

    it('replaces an unsafe incoming id instead of logging it', () => {
        const [line] = run(
            fakeRequest('/v1/sales', { 'x-request-id': 'bad id\nforged line' }),
            fakeResponse(),
        );

        expect(line).not.toContain('forged');
    });

    it.each([
        ['/v1/sales', '/v1/sales'],
        ['/v1/sales?', '/v1/sales'],
        ['/v1/sales/details/abc?x=1?y=2', '/v1/sales/details/abc'],
    ])('pathOf(%s) is %s', (url, path) => {
        expect(pathOf(fakeRequest(url))).toBe(path);
    });
});
