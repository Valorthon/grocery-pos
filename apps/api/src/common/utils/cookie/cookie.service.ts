import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { TypedConfigService } from '../../typed-config/typed-config.service';
import {
    LEGACY_REFRESH_COOKIE_PATH,
    MS_PER_SECOND,
    REFRESH_COOKIE_PATH,
} from '../../../constants';
import { isDeployedEnv } from '../../typed-config/app-env';

/**
 * Milliseconds from now until `expiresAt`, never negative. Cookies that
 * belong to a session use it as their maxAge, so they expire when the
 * session does (#21): sessions are a fixed length from login, and a
 * refresh must not make the browser think it was extended.
 */
export function msUntil(expiresAt: Date): number {
    return Math.max(0, expiresAt.getTime() - Date.now());
}

@Injectable()
export class CookieService {
    /**
     * prod and stage (APP_ENV) are both served over HTTPS, so their
     * cookies are Secure (#29: stage used to get plain cookies).
     */
    private readonly isDeployed: boolean;
    private readonly isDomainSet: boolean;

    constructor(private config: TypedConfigService) {
        this.isDeployed = isDeployedEnv(config.get('APP_ENV'));
        this.isDomainSet = !!config.get('DOMAIN');
    }

    createSecure(
        res: Response,
        name: string,
        payload: string,
        maxAge: number,
        path: string = '/',
    ) {
        res.cookie(name, payload, {
            httpOnly: true,
            secure: this.isDeployed,
            sameSite: this.isDeployed && !this.isDomainSet ? 'none' : 'lax',
            signed: true,
            maxAge,
            path: path,
            domain: this.config.get('DOMAIN') || undefined,
        });
    }

    removeSecure(res: Response, name: string, path: string = '/') {
        res.clearCookie(name, {
            httpOnly: true,
            secure: this.isDeployed,
            sameSite: this.isDeployed && !this.isDomainSet ? 'none' : 'lax',
            signed: true,
            path: path,
            domain: this.config.get('DOMAIN') || undefined,
        });
    }

    /**
     * Also clears the cookie from its old, narrower path first: the browser
     * keys cookies by name and path, so a leftover one would otherwise keep
     * being sent (first, being more specific) to `/auth/refresh`.
     *
     * Expires with the session (`sessionExpiry`, the token's stored
     * expiry), not a full `REFRESH_EXPIRY_S` from now.
     */
    createRefresh(res: Response, payload: string, sessionExpiry: Date) {
        this.removeSecure(res, 'refresh', LEGACY_REFRESH_COOKIE_PATH);
        this.createSecure(
            res,
            'refresh',
            payload,
            msUntil(sessionExpiry),
            REFRESH_COOKIE_PATH,
        );
    }

    removeRefresh(res: Response) {
        this.removeSecure(res, 'refresh', LEGACY_REFRESH_COOKIE_PATH);
        this.removeSecure(res, 'refresh', REFRESH_COOKIE_PATH);
    }

    /** Lives `JWT_EXPIRY_S`, but never past the end of the session. */
    createJwt(res: Response, payload: string, sessionExpiry: Date) {
        this.createSecure(
            res,
            'jwt',
            payload,
            Math.min(
                this.config.get('JWT_EXPIRY_S') * MS_PER_SECOND,
                msUntil(sessionExpiry),
            ),
        );
    }

    removeJwt(res: Response) {
        this.removeSecure(res, 'jwt');
    }

    /**
     * The readable session marker the client checks (`dummy=true`). It
     * expires with the refresh cookie, so it is present exactly while the
     * session can still be renewed.
     */
    createDummy(res: Response, sessionExpiry: Date) {
        res.cookie('dummy', 'true', {
            httpOnly: false,
            secure: this.isDeployed,
            sameSite: this.isDeployed && !this.isDomainSet ? 'none' : 'lax',
            signed: false,
            maxAge: msUntil(sessionExpiry),
            path: '/',
            domain: this.config.get('DOMAIN') || undefined,
        });
    }

    removeDummy(res: Response) {
        res.clearCookie('dummy', {
            httpOnly: false,
            secure: this.isDeployed,
            sameSite: this.isDeployed && !this.isDomainSet ? 'none' : 'lax',
            signed: false,
            path: '/',
            domain: this.config.get('DOMAIN') || undefined,
        });
    }
}
