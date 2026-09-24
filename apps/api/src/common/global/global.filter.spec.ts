import { ArgumentsHost } from '@nestjs/common';
import { GlobalFilter } from './global.filter';
import { JWTInvalidError } from '../../auth/types';
import { AuthError, ErrorCode } from '../errors';

function hostFor(url: string) {
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
    const host = {
        switchToHttp: () => ({
            getResponse: () => res,
            getRequest: () => ({ url }),
        }),
    } as unknown as ArgumentsHost;
    return { host, res };
}

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
