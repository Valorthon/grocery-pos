import {
    applyDecorators,
    ExecutionContext,
    Injectable,
    Module,
    UseGuards,
} from '@nestjs/common';
import {
    InjectThrottlerStorage,
    normalizeIp,
    SkipThrottle,
    Throttle,
    ThrottlerGuard,
    ThrottlerModule,
} from '@nestjs/throttler';
import type { ThrottlerLimitDetail, ThrottlerStorage } from '@nestjs/throttler';
import type { Response } from 'express';
import { RateLimitError } from '../../common/errors';

/**
 * Brute-force protection for the credential-bearing routes (issue #12).
 *
 * Two named throttlers, each counted per route:
 * - `ip`: every request from one client IP. The outer bound, sized so a
 *   shop's POS terminals sharing one public IP never trip it in normal use.
 * - `account`: one account's attempts. On the password change it is the
 *   signed-in user (a guard). On login it is IP + username, counted by
 *   `LoginAttemptLimiter` inside the handler, i.e. AFTER the global
 *   SanitationPipe and LoginDto have normalised the username: guards run
 *   before pipes and see the raw body, where `<b>admin</b>`, `ad<i></i>min`
 *   and `a&#100;min` would each get a fresh bucket yet all sign in as
 *   `admin`. It is counted before the account is looked up, so it cannot
 *   leak whether the name exists.
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

/** Authenticated attempts are counted per user, whatever IP they come from. */
export function userTracker(req: RequestLike): string {
    return req.user?.userId ? `user:${req.user.userId}` : clientIp(req);
}

/**
 * The throttler guard, answering with the app's own 429 `AppError` so the
 * body has the same shape as every other error (via GlobalFilter), plus a
 * standard `Retry-After` header next to the throttler's `Retry-After-<name>`.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
    protected throwThrottlingException(
        context: ExecutionContext,
        detail: ThrottlerLimitDetail,
    ): Promise<void> {
        throw rateLimited(
            context.switchToHttp().getResponse<Response>(),
            detail.timeToBlockExpire,
        );
    }
}

/**
 * The 429 for a blocked request. The throttler only sets
 * `Retry-After-<name>`; this adds the standard `Retry-After` header (seconds)
 * that clients and proxies understand.
 */
function rateLimited(
    res: Response,
    timeToBlockExpireS: number,
): RateLimitError {
    const retryAfterS = Math.max(1, timeToBlockExpireS);
    res.setHeader('Retry-After', String(retryAfterS));
    return new RateLimitError(
        `Too many attempts. Try again in ${retryAfterS} seconds.`,
        { retryAfterS },
    );
}

/**
 * Login's per-account budget: IP + the username as validated (sanitised,
 * trimmed, lowercased), counted in the same throttler storage as the guards.
 * Call it from the handler, before the credentials are checked.
 */
@Injectable()
export class LoginAttemptLimiter {
    constructor(
        @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    ) {}

    async hit(res: Response, ip: string, username: string): Promise<void> {
        const { limit, ttl } = RATE_LIMITS.login.account;
        const { isBlocked, timeToBlockExpire } = await this.storage.increment(
            `login-account|${ip}|${username}`,
            ttl,
            limit,
            ttl,
            THROTTLER_ACCOUNT,
        );
        if (isBlocked) {
            res.setHeader(
                `Retry-After-${THROTTLER_ACCOUNT}`,
                String(timeToBlockExpire),
            );
            throw rateLimited(res, timeToBlockExpire);
        }
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
    providers: [RateLimitGuard, LoginAttemptLimiter],
    exports: [RateLimitGuard, LoginAttemptLimiter],
})
export class RateLimitModule {}

/**
 * `POST /auth/login`: per IP here; per IP + username through
 * `LoginAttemptLimiter` in the handler (see the top of this file).
 */
export const LoginRateLimit = () =>
    applyDecorators(
        Throttle({ [THROTTLER_IP]: RATE_LIMITS.login.ip }),
        SkipThrottle({ [THROTTLER_ACCOUNT]: true }),
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
