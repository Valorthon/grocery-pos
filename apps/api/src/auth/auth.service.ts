import { Injectable } from '@nestjs/common';
import { LoginDto } from './types';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { JWTPayload } from './types/auth.types';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { RefreshTokenService } from './refresh-token/refresh-token.service';
import { AuthError, ErrorCode } from '../common/errors';

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

        const { refreshId, sid } = await this.refreshTokenService.create(
            userInfo._id.toString(),
        );

        const jwtPayload = {
            userId: userInfo._id.toString(),
            username: userInfo.name,
            roles: userInfo.roles,
            sid,
        };

        return {
            refreshPayload: JSON.stringify({ refreshId }),
            jwtPayload: this.signJWT(jwtPayload),
            user: { username },
        };
    }

    async refresh(oldRefreshId: string) {
        const { refreshId, jwtPayload } =
            await this.refreshTokenService.rotate(oldRefreshId);
        return {
            refreshPayload: JSON.stringify({ refreshId }),
            jwtPayload: this.signJWT(jwtPayload),
        };
    }

    async logout(refreshTokenId: string): Promise<void> {
        await this.refreshTokenService.invalidate(refreshTokenId);
    }

    signJWT(payload: JWTPayload): string {
        return this.jwtService.sign(payload, {
            expiresIn: this.config.get('JWT_EXPIRY_S'),
            secret: this.config.get('JWT_SECRET'),
        });
    }
}
