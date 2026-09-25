import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { RefreshToken } from './refresh-token.schema';
import { Model, Types } from 'mongoose';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import { JWTPayload, Role } from '../types';
import { AuthError, ErrorCode } from '../../common/errors';
import { MS_PER_SECOND } from '../../constants';

/** A stored token with its user populated (`null` once the user is deleted). */
type FoundRefresh = Omit<RefreshToken, 'user'> & {
    _id: Types.ObjectId;
    user: {
        _id: Types.ObjectId;
        name: string;
        roles: Role[];
        isActive: boolean;
    } | null;
};

export interface CreatedRefresh {
    refreshId: string;
    /** The session (token family) id, carried in the access token as `sid`. */
    sid: string;
}

const loginAgain = (code: ErrorCode) =>
    new AuthError(code, 'Please log in again');

@Injectable()
export class RefreshTokenService {
    private readonly logger = new Logger(RefreshTokenService.name);

    constructor(
        @InjectModel(RefreshToken.name) private model: Model<RefreshToken>,
        private config: TypedConfigService,
    ) {}

    /**
     * Stores a new refresh token. Without `family` it starts a new session
     * (login); rotation passes the old token's family and expiry on.
     */
    async create(
        userId: string,
        opts: { expiry?: Date; family?: string } = {},
    ): Promise<CreatedRefresh> {
        const expiry =
            opts.expiry ??
            new Date(
                Date.now() +
                    this.config.get('REFRESH_EXPIRY_S') * MS_PER_SECOND,
            );
        const family = opts.family ?? new Types.ObjectId().toString();

        const [created] = await this.model.create([
            { user: userId, expiry, family },
        ]);

        return { refreshId: created._id.toString(), sid: family };
    }

    /**
     * Swaps a refresh token for a new one and the access token payload.
     *
     * Every way the token or its owner is no longer good is a 401: unknown
     * (revoked, logged out or already rotated), expired, or belonging to a
     * user who has since been deactivated or deleted.
     *
     * Create-then-delete, so a database failure part-way never leaves the
     * client holding a cookie for a token that no longer exists:
     * - `create` fails: the old token is untouched and still works.
     * - the delete fails: the error propagates (500, cookies kept), the old
     *   token still works and the unsent new one is removed best-effort
     *   (or by the TTL index).
     * The delete is also the single-use check: if another request rotated,
     * logged out or revoked the old token in between, nothing is deleted,
     * the new token is withdrawn and this call is a 401.
     */
    async rotate(
        refreshId: string,
    ): Promise<{ refreshId: string; jwtPayload: JWTPayload }> {
        const found = await this.model
            .findById(refreshId)
            .populate({ path: 'user', select: 'name roles isActive' })
            .lean<FoundRefresh>();

        if (!found) throw loginAgain(ErrorCode.AUTH_INVALID_TOKEN);

        if (!this.checkValid(found)) {
            await this.bestEffort(this.model.deleteOne({ _id: found._id }));
            throw loginAgain(ErrorCode.AUTH_TOKEN_EXPIRED);
        }

        const user = found.user;
        if (!user || !user.isActive) {
            await this.bestEffort(
                user
                    ? this.model.deleteMany({ user: user._id })
                    : this.model.deleteOne({ _id: found._id }),
            );
            throw loginAgain(ErrorCode.AUTH_INVALID_TOKEN);
        }

        const next = await this.create(user._id.toString(), {
            expiry: found.expiry,
            // Rows from before sessions had ids start one here.
            family: found.family?.toString(),
        });

        let deleted: number;
        try {
            ({ deletedCount: deleted } = await this.model.deleteOne({
                _id: found._id,
            }));
        } catch (err) {
            await this.bestEffort(
                this.model.deleteOne({ _id: next.refreshId }),
            );
            throw err;
        }

        if (deleted === 0) {
            await this.bestEffort(
                this.model.deleteOne({ _id: next.refreshId }),
            );
            throw loginAgain(ErrorCode.AUTH_INVALID_TOKEN);
        }

        return {
            refreshId: next.refreshId,
            jwtPayload: {
                userId: user._id.toString(),
                username: user.name,
                roles: user.roles,
                sid: next.sid,
            },
        };
    }

    /** Logout: revokes one refresh token. */
    async invalidate(_id: string): Promise<void> {
        await this.model.deleteOne({ _id });
    }

    /**
     * Ends every session of `userId` by deleting its refresh tokens, except
     * the session `keepSid` when given (the caller's own). Access tokens
     * already issued stay valid until they expire (`JWT_EXPIRY_S`).
     */
    async revokeAllForUser(
        userId: string,
        opts: { keepSid?: string } = {},
    ): Promise<void> {
        const keep =
            opts.keepSid && Types.ObjectId.isValid(opts.keepSid)
                ? { family: { $ne: new Types.ObjectId(opts.keepSid) } }
                : {};
        await this.model.deleteMany({ user: userId, ...keep });
    }

    /** Ends every session of each of `userIds`. */
    async revokeAllForUsers(userIds: readonly string[]): Promise<void> {
        if (userIds.length === 0) return;
        await this.model.deleteMany({ user: { $in: [...userIds] } });
    }

    private checkValid(refreshToken: FoundRefresh): boolean {
        return (
            refreshToken.expiry.getTime() > Date.now() && refreshToken.isValid
        );
    }

    /** Cleanup that must not turn the real answer into a 500. */
    private async bestEffort(op: PromiseLike<unknown>): Promise<void> {
        try {
            await op;
        } catch (err) {
            this.logger.warn(`Refresh token cleanup failed: ${String(err)}`);
        }
    }
}
