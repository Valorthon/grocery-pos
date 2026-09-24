import { Body, Controller, Logger, Post, Req, Res } from '@nestjs/common';
import { LoginDto } from './types';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { CookieService } from '../common/utils/cookie/cookie.service';
import { Public } from './auth.decorator';
import { AppError, AuthError, ErrorCode } from '../common/errors';
import 'cookie-parser';

/**
 * Reads the refresh token id out of the signed `refresh` cookie, or `null`
 * when the cookie holds anything else (tampered cookies are already `false`
 * after cookie-parser's signature check).
 */
function readRefreshId(cookie: unknown): string | null {
    if (typeof cookie !== 'string') return null;
    try {
        const { refreshId } = JSON.parse(cookie) as { refreshId?: unknown };
        return typeof refreshId === 'string' &&
            Types.ObjectId.isValid(refreshId)
            ? refreshId
            : null;
    } catch {
        return null;
    }
}

@Controller('auth')
export class AuthController {
    constructor(
        private service: AuthService,
        private cookieService: CookieService,
    ) {}

    @Public()
    @Post('login')
    async login(
        @Body() dto: LoginDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const { refreshPayload, jwtPayload, user } =
            await this.service.login(dto);

        this.cookieService.createJwt(res, jwtPayload);
        this.cookieService.createRefresh(res, refreshPayload);
        this.cookieService.createDummy(res);

        return { user };
    }

    /**
     * Every way the refresh token can be unusable -- no cookie, a malformed
     * one, unknown, revoked, already rotated (reused) or expired -- is a 401
     * and clears the session cookies, so the client sends the user to login.
     * Anything else (e.g. the database being down) propagates as-is and
     * leaves the cookies alone: a transient failure must not end the session.
     */
    @Public()
    @Post('refresh')
    async refresh(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        try {
            const cookie: unknown = req.signedCookies?.['refresh'];
            if (cookie === undefined)
                throw new AuthError(
                    ErrorCode.AUTH_MISSING_REFRESH_TOKEN,
                    'Please log in again',
                );

            const refreshId = readRefreshId(cookie);
            if (!refreshId)
                throw new AuthError(
                    ErrorCode.AUTH_INVALID_TOKEN,
                    'Please log in again',
                );

            const { refreshPayload, jwtPayload } =
                await this.service.refresh(refreshId);

            this.cookieService.createRefresh(res, refreshPayload);
            this.cookieService.createJwt(res, jwtPayload);
            this.cookieService.createDummy(res);
        } catch (err) {
            if (err instanceof AppError && err.statusCode === 401) {
                this.cookieService.removeRefresh(res);
                this.cookieService.removeJwt(res);
                this.cookieService.removeDummy(res);
            }
            throw err;
        }
    }

    /**
     * Public, so an expired access token does not block it. Idempotent: with
     * no usable refresh cookie there is nothing to revoke, and the session
     * cookies are cleared either way.
     */
    @Public()
    @Post('logout')
    async logout(
        @Res({ passthrough: true }) res: Response,
        @Req() req: Request,
    ) {
        const refreshId = readRefreshId(req.signedCookies?.['refresh']);

        if (refreshId) {
            try {
                await this.service.logout(refreshId);
            } catch (err) {
                Logger.warn('Could not revoke refresh token on logout', err);
            }
        }

        this.cookieService.removeJwt(res);
        this.cookieService.removeRefresh(res);
        this.cookieService.removeDummy(res);
    }
}
