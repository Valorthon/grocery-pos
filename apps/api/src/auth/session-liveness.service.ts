import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../user/user.schema';
import { RefreshToken } from './refresh-token/refresh-token.schema';
import type { JWTPayload } from './types';

/**
 * Per-request check behind the JWT strategy (#480): an access token only
 * counts while its user is still active and, when it names a session
 * (`sid`), that session still has a live refresh token. Deactivation, role
 * changes and password resets delete the user's refresh tokens, so their
 * unexpired access tokens stop working at once instead of at expiry.
 */
@Injectable()
export class SessionLivenessService {
    constructor(
        @InjectModel(User.name) protected readonly users: Model<User>,
        @InjectModel(RefreshToken.name)
        protected readonly tokens: Model<RefreshToken>,
    ) {}

    async isLive(payload: JWTPayload): Promise<boolean> {
        const { userId, sid } = payload;
        if (typeof userId !== 'string' || !Types.ObjectId.isValid(userId))
            return false;
        const row = await this.users
            .findById(userId)
            .select('isActive')
            .lean<{ isActive?: boolean }>();
        if (!row || row.isActive === false) return false;
        const user = new Types.ObjectId(userId);
        if (sid === undefined) return true;
        if (typeof sid !== 'string' || !Types.ObjectId.isValid(sid))
            return false;
        const live = await this.tokens.exists({
            user,
            family: new Types.ObjectId(sid),
            expiry: { $gt: new Date() },
        });
        return live !== null;
    }
}
