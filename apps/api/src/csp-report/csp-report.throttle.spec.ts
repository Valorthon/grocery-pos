import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CspReportLimiter } from '../auth/rate-limit/rate-limit';
import { CSP_REPORT_PATH } from './csp-report';
import { cspReportLimit, useCspReportLimit } from './csp-report.throttle';

describe('cspReportLimit (#108)', () => {
    const res = {} as Response;

    it('counts a POST, then goes on', async () => {
        const hit = jest.fn().mockResolvedValue(undefined);
        const next = jest.fn();
        cspReportLimit({ hit })(
            { method: 'POST' } as Request,
            res,
            next as NextFunction,
        );
        await new Promise(setImmediate);
        expect(hit).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    it('passes a 429 on to the error handler', async () => {
        const limited = new Error('429');
        const next = jest.fn();
        cspReportLimit({ hit: jest.fn().mockRejectedValue(limited) })(
            { method: 'POST' } as Request,
            res,
            next as NextFunction,
        );
        await new Promise(setImmediate);
        expect(next).toHaveBeenCalledWith(limited);
    });

    it('does not count other methods', () => {
        const hit = jest.fn();
        const next = jest.fn();
        cspReportLimit({ hit })(
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
