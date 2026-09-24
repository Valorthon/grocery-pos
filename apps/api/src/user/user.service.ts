import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { User } from './user.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import * as argon from 'argon2';
import { Role } from '../auth/types/auth.types';
import {
    ChangePasswordDto,
    CreateBulkDto,
    GetAllDto,
    UpdateBulkDto,
} from './types';
import { runInTransaction } from '../common/utils/db';
import type { AuthUser } from '../auth/types';
import { ErrorCode, ForbiddenError, NotFoundError } from '../common/errors';
import {
    assertCanGrant,
    assertCanUpdate,
    PolicyUser,
    removesActiveAdmin,
    sameRoles,
} from './user.policy';

/** The one argon2 check behind login and the self-service password change. */
function verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon.verify(hash, password);
}

function toPolicyUser(doc: {
    _id: Types.ObjectId;
    roles: Role[];
    isActive: boolean;
}): PolicyUser {
    return { id: doc._id.toString(), roles: doc.roles, isActive: doc.isActive };
}

class UserInfo {
    name!: string;
    roles!: Role[];
    _id!: Types.ObjectId;
    isActive!: boolean;
}

@Injectable()
export class UserService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(User.name) private model: Model<User>,
    ) {}

    async getAll(
        dto: GetAllDto,
    ): Promise<{ data: User[]; totalItems: number }> {
        const { page, limit, name } = dto;

        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = {};
        if (name) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.name = { $regex: `^${escaped}` };
        }

        const [data, totalItems] = await Promise.all([
            this.model
                .find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('-passwordHash -__v')
                .lean(),

            query?.name
                ? this.model.countDocuments(query)
                : this.model.estimatedDocumentCount(),
        ]);

        return {
            data,
            totalItems,
        };
    }

    /**
     * `PATCH /users`. Every entry is authorized against the actor's and the
     * target's stored state inside one transaction, then applied with
     * `updateOne` + `runValidators` (bulkWrite would skip the schema's role
     * enum), then the last-active-ADMIN invariant is re-checked before the
     * transaction commits.
     *
     * Returns the ids whose roles changed or who were deactivated: the users
     * whose existing sessions no longer match their stored state (the hook
     * for revoking them, issue #12).
     */
    async update(
        actor: AuthUser,
        dto: UpdateBulkDto,
        session?: ClientSession,
    ): Promise<string[]> {
        return await runInTransaction(
            async (session) => {
                const actorInfo = await this.loadActor(actor, session);

                const ids = dto.updates.map(({ user }) => user);
                const targets = new Map(
                    (
                        await this.model
                            .find({ _id: { $in: ids } })
                            .select('roles isActive')
                            .session(session)
                            .lean()
                    ).map((doc) => [doc._id.toString(), toPolicyUser(doc)]),
                );

                const missing = ids.filter((id) => !targets.has(id));
                if (missing.length > 0) {
                    throw new NotFoundError(
                        ErrorCode.NOT_FOUND,
                        'User not found',
                        { users: missing },
                    );
                }

                const planned = dto.updates.map(({ user, update }) => ({
                    target: targets.get(user)!,
                    update,
                }));

                for (const { target, update } of planned) {
                    assertCanUpdate(actorInfo, target, update);
                }

                const demotesAdmin = planned.some(({ target, update }) =>
                    removesActiveAdmin(target, update),
                );
                if (demotesAdmin) await this.lockActiveAdmins(session);

                // Sequential: operations sharing a transaction session must
                // not run concurrently.
                for (const { target, update } of planned) {
                    const { password, ...fields } = update;
                    const set: Record<string, unknown> = { ...fields };
                    if (password !== undefined) {
                        set.passwordHash = await argon.hash(password);
                    }
                    await this.model.updateOne(
                        { _id: target.id },
                        { $set: set },
                        { session, runValidators: true },
                    );
                }

                if (demotesAdmin) {
                    const remaining = await this.model
                        .countDocuments({ roles: Role.Admin, isActive: true })
                        .session(session);
                    if (remaining === 0) {
                        throw new ForbiddenError(
                            ErrorCode.USER_LAST_ADMIN,
                            'This would leave no active admin',
                        );
                    }
                }

                return planned
                    .filter(
                        ({ target, update }) =>
                            update.isActive === false ||
                            (update.roles !== undefined &&
                                !sameRoles(update.roles, target.roles)),
                    )
                    .map(({ target }) => target.id);
            },
            this.connection,
            session,
        );
    }

    /**
     * Writes every active ADMIN document, so two transactions that could
     * each remove a different admin write-conflict instead of both passing
     * the "someone else is still admin" check on their own snapshot (write
     * skew). The loser is retried by `withTransaction` and then sees the
     * winner's change, so the final count check refuses it.
     */
    private async lockActiveAdmins(session: ClientSession): Promise<void> {
        await this.model.updateMany(
            { roles: Role.Admin, isActive: true },
            { $set: { updatedAt: new Date() } },
            { session, timestamps: false },
        );
    }

    /** The actor's stored roles; a deleted or deactivated actor gets none. */
    private async loadActor(
        actor: AuthUser,
        session: ClientSession,
    ): Promise<PolicyUser> {
        const doc = await this.model
            .findById(actor.userId)
            .select('roles isActive')
            .session(session)
            .lean();

        if (!doc || !doc.isActive) {
            throw new ForbiddenError(
                ErrorCode.FORBIDDEN,
                'Your account can no longer manage users',
            );
        }

        return toPolicyUser(doc);
    }

    /** `POST /users`: the actor may only give out roles they hold. */
    async create(
        actor: AuthUser,
        dto: CreateBulkDto,
        session?: ClientSession,
    ): Promise<void> {
        await runInTransaction(
            async (session) => {
                const actorInfo = await this.loadActor(actor, session);
                for (const user of dto.users) {
                    assertCanGrant(actorInfo.roles, user.roles);
                }

                const inserts = await Promise.all(
                    dto.users.map(async (user) => ({
                        name: user.name,
                        passwordHash: await argon.hash(user.password),
                        roles: user.roles,
                    })),
                );

                await this.model.insertMany(inserts, { session });
            },
            this.connection,
            session,
        );
    }

    /**
     * `PATCH /users/me/password`: any signed-in user changes their own
     * password after proving the current one.
     */
    async changeOwnPassword(
        actor: AuthUser,
        dto: ChangePasswordDto,
    ): Promise<void> {
        const user = await this.model
            .findById(actor.userId)
            .select('passwordHash isActive')
            .lean();

        if (!user || !user.isActive) {
            throw new ForbiddenError(
                ErrorCode.FORBIDDEN,
                'Your account cannot change its password',
            );
        }

        if (!(await verifyPassword(user.passwordHash, dto.currentPassword))) {
            throw new ForbiddenError(
                ErrorCode.USER_WRONG_PASSWORD,
                'Current password is incorrect',
            );
        }

        // Matching on the old hash makes a concurrent change of the same
        // password lose instead of silently overwriting the winner.
        const result = await this.model.updateOne(
            { _id: user._id, passwordHash: user.passwordHash },
            { $set: { passwordHash: await argon.hash(dto.newPassword) } },
            { runValidators: true },
        );

        if (result.matchedCount === 0) {
            throw new ForbiddenError(
                ErrorCode.USER_WRONG_PASSWORD,
                'Current password is incorrect',
            );
        }
    }

    async checkCredentials(
        username: string,
        password: string,
    ): Promise<UserInfo | null> {
        const user = await this.model.findOne({ name: username }).lean();

        if (!user) {
            return null;
        }

        if (!(await verifyPassword(user.passwordHash, password))) {
            return null;
        }

        return {
            name: user.name,
            roles: user.roles,
            _id: user._id,
            isActive: user.isActive,
        };
    }
}
