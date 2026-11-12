import { AppError, ErrorCode, ForbiddenError } from '.';

describe('AppError status mapping', () => {
    it('answers USER_REAUTH_REQUIRED with 403, never 401 (#310)', () => {
        // Every 401 makes the client refresh and replay the request.
        expect(AppError.getHttpStatus(ErrorCode.USER_REAUTH_REQUIRED)).toBe(
            403,
        );
        expect(
            new ForbiddenError(ErrorCode.USER_REAUTH_REQUIRED, 'x').statusCode,
        ).toBe(403);
    });
});
