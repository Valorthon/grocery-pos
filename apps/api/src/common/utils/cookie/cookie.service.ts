import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { TypedConfigService } from '../../typed-config/typed-config.service';

@Injectable()
export class CookieService {
    private readonly isProd: boolean;
    private readonly isDomainSet: boolean;

    constructor(private config: TypedConfigService) {
        this.isProd = config.get('NODE_ENV') === 'prod';
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
            secure: this.isProd,
            sameSite: this.isProd && !this.isDomainSet ? 'none' : 'lax',
            signed: true,
            maxAge,
            path: path,
            domain: this.config.get('DOMAIN') || undefined,
        });
    }

    removeSecure(res: Response, name: string, path: string = '/') {
        res.clearCookie(name, {
            httpOnly: true,
            secure: this.isProd,
            sameSite: this.isProd && !this.isDomainSet ? 'none' : 'lax',
            signed: true,
            path: path,
            domain: this.config.get('DOMAIN') || undefined,
        });
    }

    createRefresh(res: Response, payload: string) {
        this.createSecure(
            res,
            'refresh',
            payload,
            this.config.get('REFRESH_EXPIRY'),
            '/api/auth/refresh',
        );
    }

    removeRefresh(res: Response) {
        this.removeSecure(res, 'refresh', '/api/auth/refresh');
    }

    createJwt(res: Response, payload: string) {
        this.createSecure(res, 'jwt', payload, this.config.get('JWT_EXPIRY'));
    }

    removeJwt(res: Response) {
        this.removeSecure(res, 'jwt');
    }

    createDummy(res: Response) {
        res.cookie('dummy', 'true', {
            httpOnly: false,
            secure: this.isProd,
            sameSite: this.isProd && !this.isDomainSet ? 'none' : 'lax',
            signed: false,
            maxAge: this.config.get('REFRESH_EXPIRY'),
            path: '/',
            domain: this.config.get('DOMAIN') || undefined,
        });
    }

    removeDummy(res: Response) {
        res.clearCookie('dummy', {
            httpOnly: false,
            secure: this.isProd,
            sameSite: this.isProd && !this.isDomainSet ? 'none' : 'lax',
            signed: false,
            path: '/',
            domain: this.config.get('DOMAIN') || undefined,
        });
    }
}
