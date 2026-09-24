import { AuthError, ErrorCode } from '../../common/errors';

/**
 * Thrown by `JWTAuthGuard` when a protected route is called without a usable
 * access token. It is a 401 `AppError`, so the client's interceptor refreshes
 * the session and replays the request.
 *
 * - `AUTH_TOKEN_EXPIRED`: the token was valid but its `exp` has passed.
 * - `AUTH_INVALID_TOKEN`: no token, a malformed one, or a bad signature.
 */
export class JWTInvalidError extends AuthError {
    constructor(
        code:
            | ErrorCode.AUTH_TOKEN_EXPIRED
            | ErrorCode.AUTH_INVALID_TOKEN = ErrorCode.AUTH_INVALID_TOKEN,
    ) {
        super(
            code,
            code === ErrorCode.AUTH_TOKEN_EXPIRED
                ? 'Session expired'
                : 'Not authenticated',
        );
    }

    /**
     * Picks the code from what passport-jwt reports: `info` is jsonwebtoken's
     * `TokenExpiredError` for an expired token, a `JsonWebTokenError` for a
     * bad one, or a plain `Error('No auth token')` when there is none.
     * Matched by name so a second copy of jsonwebtoken cannot break it.
     */
    static from(info: unknown): JWTInvalidError {
        const expired =
            info instanceof Error && info.name === 'TokenExpiredError';
        return new JWTInvalidError(
            expired
                ? ErrorCode.AUTH_TOKEN_EXPIRED
                : ErrorCode.AUTH_INVALID_TOKEN,
        );
    }
}
