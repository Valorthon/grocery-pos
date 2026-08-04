import { Body, Controller, Logger, Post, Req, Res } from '@nestjs/common';
import { LoginDto, Role } from './types';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CookieService } from '../common/utils/cookie/cookie.service';
import { Public, Roles } from './auth.decorator';
import { AuthError, ErrorCode, InternalError } from '../common/errors';
import 'cookie-parser';

@Controller('auth')
export class AuthController {
    constructor(
        private service: AuthService,
        private cookieService: CookieService,
    ) {}

    @Public()
    @Roles(Role.Unauthenticated)
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

        Logger.log({ jwtPayload });
        return { user };
    }

    @Public()
    @Roles(Role.Unauthenticated)
    @Post('refresh')
    async refresh(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const oldRefreshPayload = req.signedCookies['refresh'] as
            | string
            | undefined;

        if (!oldRefreshPayload)
            throw new InternalError('Missing Refresh Cookie');

        try {
            const { refreshId } = JSON.parse(oldRefreshPayload) as {
                refreshId: string;
            };

            if (!refreshId) throw new InternalError('Missing Refresh Token');

            const { refreshPayload, jwtPayload } =
                await this.service.refresh(refreshId);

            this.cookieService.createRefresh(res, refreshPayload);
            this.cookieService.createJwt(res, jwtPayload);
            this.cookieService.createDummy(res);
        } catch (err) {
            this.cookieService.removeRefresh(res);
            this.cookieService.removeJwt(res);
            this.cookieService.removeDummy(res);

            Logger.error(err);
            throw new AuthError(
                ErrorCode.AUTH_TOKEN_EXPIRED,
                'Please log in again',
            );
        }
    }

    @Public()
    @Post('logout')
    async logout(
        @Res({ passthrough: true }) res: Response,
        @Req() req: Request,
    ) {
        const refreshPayload = req.signedCookies['refresh'] as
            | string
            | undefined;

        if (!refreshPayload) throw new InternalError('Missing Refresh Cookie');

        try {
            const { refreshId } = JSON.parse(refreshPayload) as {
                refreshId: string;
            };

            if (!refreshId) throw new InternalError('Missing Refresh Token');

            await this.service.logout(refreshId);
        } catch (err) {
            Logger.warn('refreshPayload does not have valid content', err);
        }

        this.cookieService.removeJwt(res);
        this.cookieService.removeRefresh(res);
        this.cookieService.removeDummy(res);
    }
}
