import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { Types } from 'mongoose';
import { STEP_UP_TTL_S, type AuthUser } from '@grocery-pos/contracts';
import { StepUp } from './step-up.schema';
import { RefreshToken } from '../refresh-token/refresh-token.schema';
import { ErrorCode, ForbiddenError } from '../../common/errors';
import { MS_PER_SECOND } from '../../constants';

export const reauthRequired = () =>
    new ForbiddenError(
        ErrorCode.USER_REAUTH_REQUIRED,
        'Confirm your password to make this change',
    );

/**
 * Step-up re-authentication (#310): `POST /auth/reauth` grants it for the
 * caller's session, and guarded account changes assert it inside their own
 * transaction.
 */
@Injectable()
export class StepUpService {
    constructor(
        @InjectModel(StepUp.name) private stepUps: Model<StepUp>,
        @InjectModel(RefreshToken.name) private tokens: Model<RefreshToken>,
    ) {}

    /**
     * Records a step-up for `{userId, sid}` lasting `STEP_UP_TTL_S` from now.
     * A later re-auth starts a new window; a guarded action never extends it.
     */
    async grant(userId: string, sid: string): Promise<Date> {
        const expiresAt = new Date(Date.now() + STEP_UP_TTL_S * MS_PER_SECOND);
        await this.stepUps.updateOne(
            { user: new Types.ObjectId(userId), sid },
            { $set: { expiresAt } },
            { upsert: true },
        );
        return expiresAt;
    }

    /**
     * Refuses with 403 `USER_REAUTH_REQUIRED` unless the actor's session
     * still exists (a live refresh token of that family) and holds a live
     * step-up. Read in `session`, so the change commits only with both.
     */
    async assertLive(actor: AuthUser, session: ClientSession): Promise<void> {
        const { sid } = actor;
        if (!sid || !Types.ObjectId.isValid(sid)) throw reauthRequired();
        const now = new Date();
        const user = new Types.ObjectId(actor.userId);
        const stepUp = await this.stepUps
            .exists({ user, sid, expiresAt: { $gt: now } })
            .session(session);
        if (!stepUp) throw reauthRequired();
        const live = await this.tokens
            .exists({
                user,
                family: new Types.ObjectId(sid),
                expiry: { $gt: now },
            })
            .session(session);
        if (!live) throw reauthRequired();
    }

    /** Whether the session `sid` of `userId` still has a refresh token. */
    async sessionExists(userId: string, sid: string): Promise<boolean> {
        if (!Types.ObjectId.isValid(sid)) return false;
        const live = await this.tokens.exists({
            user: new Types.ObjectId(userId),
            family: new Types.ObjectId(sid),
            expiry: { $gt: new Date() },
        });
        return live !== null;
    }
}
