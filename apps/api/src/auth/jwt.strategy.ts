import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { SessionLivenessService } from './session-liveness.service';
import { JWTPayload } from './types/auth.types';

@Injectable()
export class JWTStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(
        private config: TypedConfigService,
        private liveness: SessionLivenessService,
    ) {
        super({
            jwtFromRequest: (req: Request) => {
                return (req?.signedCookies?.jwt as string | undefined) ?? null;
            },
            ignoreExpiration: false,
            secretOrKey: config.get('JWT_SECRET'),
        });
    }

    /**
     * A signed, unexpired token still fails (401 AUTH_INVALID_TOKEN via the
     * guard) once its user is deactivated or its session revoked (#480).
     */
    async validate(payload: JWTPayload): Promise<JWTPayload | false> {
        return (await this.liveness.isLive(payload)) ? payload : false;
    }
}
