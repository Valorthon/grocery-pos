import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@grocery-pos/contracts';
import { Injectable } from '@nestjs/common';
import { LoginDto } from './types';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { JWTPayload } from './types/auth.types';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { RefreshTokenService } from './refresh-token/refresh-token.service';
import { AuthError, ErrorCode, ForbiddenError } from '../common/errors';
import { StepUpService } from './step-up/step-up.service';
import type { AuthUser } from './types';
import { MS_PER_SECOND } from '../constants';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password';

@Injectable()
export class AuthService {
    constructor(
        private config: TypedConfigService,
        private userService: UserService,
        private jwtService: JwtService,
        private refreshTokenService: RefreshTokenService,
        private audit: AuditService,
        private stepUp: StepUpService,
    ) {}

    /**
     * `POST /auth/reauth` (#310): the caller re-enters their own password
     * and gets a step-up for this session, `STEP_UP_TTL_S` long. A wrong
     * password is 403 `USER_WRONG_PASSWORD` (never a 401, which the client
     * would refresh and replay). A token without `sid`, or a session that
     * has ended, cannot step up: log in again.
     */
    async reauth(actor: AuthUser, password: string): Promise<void> {
        const sid = actor.sid;
        if (!sid || !(await this.stepUp.sessionExists(actor.userId, sid)))
            throw new ForbiddenError(
                ErrorCode.FORBIDDEN,
                'Log in again to confirm it is you',
            );
        const user = await this.userService.verifyOwnPassword(
            actor.userId,
            password,
        );
        const auditActor = { userId: actor.userId, username: actor.username };
        if (!user) {
            await this.audit.record({
                actor: auditActor,
                action: AuditAction.AUTH_REAUTH_FAILED,
                targetModel: 'User',
                targetId: actor.userId,
                after: { name: actor.username },
            });
            throw new ForbiddenError(
                ErrorCode.USER_WRONG_PASSWORD,
                'That password isn’t right',
            );
        }
        await this.stepUp.grant(actor.userId, sid);
        await this.audit.record({
            actor: auditActor,
            action: AuditAction.AUTH_REAUTH,
            targetModel: 'User',
            targetId: actor.userId,
            after: { name: user.name },
        });
    }

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
            await this.audit.record({
                actor: null,
                action: AuditAction.AUTH_LOGIN_FAILED,
                targetModel: 'User',
                after: { name: username },
            });
            throw new AuthError(
                ErrorCode.AUTH_INVALID_CREDENTIALS,
                INVALID_CREDENTIALS_MESSAGE,
            );
        }

        const { refreshId, sid, expiry } =
            await this.refreshTokenService.create(userInfo._id.toString());

        await this.audit.record({
            actor: { userId: userInfo._id.toString(), username: userInfo.name },
            action: AuditAction.AUTH_LOGIN,
            targetModel: 'User',
            targetId: userInfo._id.toString(),
            after: { name: userInfo.name },
        });

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
