import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CspReportLimiter } from '../auth/rate-limit/rate-limit';
import { RateLimitError } from '../common/errors';
import { CSP_REPORT_PATH } from './csp-report';
import { cspReportLimit, useCspReportLimit } from './csp-report.throttle';

describe('cspReportLimit (#108)', () => {
    const res = {} as Response;
    const post = { method: 'POST', ip: '203.0.113.7' } as Request;
    let rateLimited: jest.Mock;

    beforeEach(() => {
        rateLimited = jest.fn();
    });

    it('counts a POST, then goes on', async () => {
        const hit = jest.fn().mockResolvedValue(undefined);
        const next = jest.fn();
        cspReportLimit({ hit }, { rateLimited })(
            post,
            res,
            next as NextFunction,
        );
        await new Promise(setImmediate);
        expect(hit).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(rateLimited).not.toHaveBeenCalled();
    });

    it('counts a 429 per IP and passes it on marked for GlobalFilter', async () => {
        const limited = new RateLimitError('Too many attempts.');
        const next = jest.fn();
        cspReportLimit(
            { hit: jest.fn().mockRejectedValue(limited) },
            { rateLimited },
        )(post, res, next as NextFunction);
        await new Promise(setImmediate);
        expect(rateLimited).toHaveBeenCalledWith('203.0.113.7');
        expect(next).toHaveBeenCalledWith(limited);
        expect(Object.getOwnPropertySymbols(limited)).toHaveLength(1);
    });

    it('passes any other failure on as it is', async () => {
        const broken = new Error('storage down');
        const next = jest.fn();
        cspReportLimit(
            { hit: jest.fn().mockRejectedValue(broken) },
            { rateLimited },
        )(post, res, next as NextFunction);
        await new Promise(setImmediate);
        expect(next).toHaveBeenCalledWith(broken);
        expect(rateLimited).not.toHaveBeenCalled();
        expect(Object.getOwnPropertySymbols(broken)).toHaveLength(0);
    });

    it('does not count other methods', () => {
        const hit = jest.fn();
        const next = jest.fn();
        cspReportLimit({ hit }, { rateLimited })(
            { method: 'OPTIONS' } as Request,
            res,
            next as NextFunction,
        );
        expect(hit).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith();
    });
});

describe('useCspReportLimit (#108)', () => {
    it('installs the limit on the route when CspReportModule is loaded', () => {
        const use = jest.fn();
        const app = {
            get: jest.fn().mockReturnValue({ hit: jest.fn() }),
            use,
        } as unknown as INestApplication;
        useCspReportLimit(app);
        expect(app.get).toHaveBeenCalledWith(CspReportLimiter, {
            strict: false,
        });
        expect(use).toHaveBeenCalledWith(CSP_REPORT_PATH, expect.any(Function));
    });

    it('installs nothing without it', () => {
        const use = jest.fn();
        const app = {
            get: jest.fn(() => {
                throw new Error('unknown element');
            }),
            use,
        } as unknown as INestApplication;
        useCspReportLimit(app);
        expect(use).not.toHaveBeenCalled();
    });
});
