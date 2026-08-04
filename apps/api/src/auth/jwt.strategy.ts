import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { JWTPayload } from './types/auth.types';

@Injectable()
export class JWTStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(private config: TypedConfigService) {
        super({
            jwtFromRequest: (req: Request) => {
                return (req?.signedCookies?.jwt as string | undefined) ?? null;
            },
            ignoreExpiration: false,
            secretOrKey: config.get('JWT_SECRET'),
        });
    }

    validate(payload: JWTPayload): JWTPayload {
        Logger.log({ payload });
        return payload;
    }
}
