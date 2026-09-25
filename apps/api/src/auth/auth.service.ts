import { Injectable } from '@nestjs/common';
import { LoginDto } from './types';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { JWTPayload } from './types/auth.types';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { RefreshTokenService } from './refresh-token/refresh-token.service';
import { AuthError, ErrorCode } from '../common/errors';
import { MS_PER_SECOND } from '../constants';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password';

@Injectable()
export class AuthService {
    constructor(
        private config: TypedConfigService,
        private userService: UserService,
        private jwtService: JwtService,
        private refreshTokenService: RefreshTokenService,
    ) {}

    async login(dto: LoginDto): Promise<{
        refreshPayload: string;
        jwtPayload: string;
        /** When the session ends; see `CreatedRefresh.expiry`. */
        sessionExpiry: Date;
        user: {
            username: string;
        };
    }> {
        const { username, password } = dto;

        const userInfo = await this.userService.checkCredentials(
            username,
            password,
        );

        // One answer for an unknown user, a wrong password and a
        // deactivated account, so the response never confirms that a
        // username exists (issue #12). checkCredentials runs an argon2
        // verify in every case, so the timing does not tell them apart
        // either.
        if (!userInfo || !userInfo.isActive) {
            throw new AuthError(
                ErrorCode.AUTH_INVALID_CREDENTIALS,
                INVALID_CREDENTIALS_MESSAGE,
            );
        }

        const { refreshId, sid, expiry } =
            await this.refreshTokenService.create(userInfo._id.toString());

        const jwtPayload = {
            userId: userInfo._id.toString(),
            username: userInfo.name,
            roles: userInfo.roles,
            sid,
        };

        return {
            refreshPayload: JSON.stringify({ refreshId }),
            jwtPayload: this.signJWT(jwtPayload, expiry),
            sessionExpiry: expiry,
            user: { username },
        };
    }

    async refresh(oldRefreshId: string) {
        const { refreshId, jwtPayload, expiry } =
            await this.refreshTokenService.rotate(oldRefreshId);
        return {
            refreshPayload: JSON.stringify({ refreshId }),
            jwtPayload: this.signJWT(jwtPayload, expiry),
            sessionExpiry: expiry,
        };
    }

    async logout(refreshTokenId: string): Promise<void> {
        await this.refreshTokenService.invalidate(refreshTokenId);
    }

    /**
     * Signs an access token that lives `JWT_EXPIRY_S`, but never past the
     * end of its session: sessions are a fixed length (#21), so the last
     * access token of one must not outlive it.
     */
    signJWT(payload: JWTPayload, sessionExpiry: Date): string {
        return this.jwtService.sign(payload, {
            expiresIn: this.accessTokenLifetimeS(sessionExpiry),
            secret: this.config.get('JWT_SECRET'),
        });
    }

    /** Seconds the access token lives: `JWT_EXPIRY_S`, capped at the session end. */
    accessTokenLifetimeS(sessionExpiry: Date): number {
        const remainingS = Math.ceil(
            (sessionExpiry.getTime() - Date.now()) / MS_PER_SECOND,
        );
        return Math.max(
            1,
            Math.min(this.config.get('JWT_EXPIRY_S'), remainingS),
        );
    }
}
