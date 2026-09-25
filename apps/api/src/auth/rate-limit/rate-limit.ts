import {
    applyDecorators,
    ExecutionContext,
    Injectable,
    Module,
    UseGuards,
} from '@nestjs/common';
import {
    normalizeIp,
    SkipThrottle,
    Throttle,
    ThrottlerGuard,
    ThrottlerModule,
} from '@nestjs/throttler';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import { RateLimitError } from '../../common/errors';
import { STRING_LIMITS } from '../../constants';

/**
 * Brute-force protection for the credential-bearing routes (issue #12).
 *
 * Two named throttlers, each counted per route:
 * - `ip`: every request from one client IP. The outer bound, sized so a
 *   shop's POS terminals sharing one public IP never trip it in normal use.
 * - `account`: one account's attempts. On login that is IP + submitted
 *   username (checked before the account is looked up, so it cannot leak
 *   whether the name exists); on the password change it is the signed-in
 *   user.
 *
 * Counters live in process memory (the throttler's default storage). That is
 * right for the single API instance deployed today; running several
 * replicas would need a shared store (e.g. Redis) or each gets its own
 * budget.
 *
 * The client IP is `req.ip`, which is only the real client when Express's
 * `trust proxy` matches the deployment (see main.ts): otherwise every
 * request looks like it comes from the proxy and shares one `ip` budget.
 */
export const THROTTLER_IP = 'ip';
export const THROTTLER_ACCOUNT = 'account';

const MINUTE_MS = 60_000;

export const RATE_LIMITS = {
    login: {
        ip: { limit: 20, ttl: MINUTE_MS },
        account: { limit: 5, ttl: MINUTE_MS },
    },
    refresh: {
        // Every open tab refreshes when its access token expires; this only
        // stops a client hammering the endpoint.
        ip: { limit: 60, ttl: MINUTE_MS },
    },
    password: {
        ip: { limit: 20, ttl: MINUTE_MS },
        account: { limit: 5, ttl: 15 * MINUTE_MS },
    },
} as const;

interface RequestLike {
    ip?: string;
    body?: unknown;
    user?: { userId?: string };
}

export function clientIp(req: RequestLike): string {
    return req.ip ? normalizeIp(req.ip) : 'unknown';
}

/** Login attempts are counted per client IP and submitted username. */
export function loginTracker(req: RequestLike): string {
    // Guards run before the ValidationPipe, so the body is still raw.
    const raw: unknown = (req.body as { username?: unknown } | undefined)
        ?.username;
    const username =
        typeof raw === 'string'
            ? raw
                  .trim()
                  .toLowerCase()
                  .slice(0, STRING_LIMITS.USERNAME + 1)
            : '';
    return `${clientIp(req)}|${username}`;
}

/** Authenticated attempts are counted per user, whatever IP they come from. */
export function userTracker(req: RequestLike): string {
    return req.user?.userId ? `user:${req.user.userId}` : clientIp(req);
}

/**
 * The throttler guard, answering with the app's own 429 `AppError` so the
 * body has the same shape as every other error (via GlobalFilter). The
 * throttler has already set `Retry-After-<name>` on the response.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
    protected throwThrottlingException(
        _context: ExecutionContext,
        detail: ThrottlerLimitDetail,
    ): Promise<void> {
        const retryAfterS = Math.max(1, detail.timeToBlockExpire);
        throw new RateLimitError(
            `Too many attempts. Try again in ${retryAfterS} seconds.`,
            { retryAfterS },
        );
    }
}

@Module({
    imports: [
        ThrottlerModule.forRoot({
            // Defaults only; every rate-limited route sets its own limits
            // through the decorators below.
            throttlers: [
                { name: THROTTLER_IP, ...RATE_LIMITS.login.ip },
                { name: THROTTLER_ACCOUNT, ...RATE_LIMITS.login.account },
            ],
        }),
    ],
    providers: [RateLimitGuard],
    exports: [RateLimitGuard],
})
export class RateLimitModule {}

/** `POST /auth/login`: per IP, and per IP + username. */
export const LoginRateLimit = () =>
    applyDecorators(
        Throttle({
            [THROTTLER_IP]: RATE_LIMITS.login.ip,
            [THROTTLER_ACCOUNT]: {
                ...RATE_LIMITS.login.account,
                getTracker: loginTracker,
            },
        }),
        UseGuards(RateLimitGuard),
    );

/** `POST /auth/refresh`: per IP only (the caller is identified by a cookie). */
export const RefreshRateLimit = () =>
    applyDecorators(
        Throttle({ [THROTTLER_IP]: RATE_LIMITS.refresh.ip }),
        SkipThrottle({ [THROTTLER_ACCOUNT]: true }),
        UseGuards(RateLimitGuard),
    );

/** `PATCH /users/me/password`: per IP, and per signed-in user. */
export const PasswordChangeRateLimit = () =>
    applyDecorators(
        Throttle({
            [THROTTLER_IP]: RATE_LIMITS.password.ip,
            [THROTTLER_ACCOUNT]: {
                ...RATE_LIMITS.password.account,
                getTracker: userTracker,
            },
        }),
        UseGuards(RateLimitGuard),
    );
