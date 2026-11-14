/**
 * First-install bootstrap (#361): creates the one initial ADMIN of an empty
 * installation, for the operator's bootstrap command only. There is no
 * HTTP route to it: ordinary user creation stays `POST /users`, signed in
 * and stepped up. Runtime DB provisioning (replica set, credentials) is
 * #360's and happens before this runs.
 *
 * - The account is ADMIN only (owner decision), active, with
 *   `mustChangePassword` so the temporary password is replaced at first
 *   login. No SELLER, no manager PIN, no demo data.
 * - One transaction: the `initial-admin` marker, the user and the
 *   allowlisted `SYSTEM.INITIAL_ADMIN_CREATED` audit entry (actor null:
 *   nobody was signed in). A failure leaves none of them.
 * - Refused when the marker exists or any user exists: an initialized or
 *   seeded database is never reset. Concurrent runs insert the same marker
 *   `_id`, so only one can commit.
 */
import * as argon from 'argon2';
import { Connection, Model, Schema, Types, type ClientSession } from 'mongoose';
import { AuditAction, Role, STRING_LIMITS } from '@grocery-pos/contracts';
import { User, UserSchema } from '../user/user.schema';
import { AuditLog, AuditLogSchema } from '../audit/audit.schema';
import { auditDocument } from '../audit/audit.service';
import { runInTransaction } from '../common/utils/db';
import { AppError, ErrorCode } from '../common/errors';

export const INITIAL_ADMIN_MARKER = 'initial-admin';
/** How the audit entry names its origin. */
export const BOOTSTRAP_SOURCE = 'bootstrap-command';

interface BootstrapMarker {
    _id: string;
    user: Types.ObjectId;
    createdAt: Date;
}
const BootstrapMarkerSchema = new Schema<BootstrapMarker>(
    {
        _id: { type: String, required: true },
        user: { type: Schema.Types.ObjectId, required: true },
        createdAt: { type: Date, required: true },
    },
    { collection: 'systembootstrap', versionKey: false },
);

/** An AppError so `runInTransaction` passes it through unwrapped. */
export class AlreadyInitializedError extends AppError {
    constructor() {
        super(
            ErrorCode.CONFLICT,
            409,
            'This database is already initialized; nothing was changed.',
        );
    }
}

export class BootstrapInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BootstrapInputError';
    }
}

export interface InitialAdminInput {
    username: string;
    password: string;
}

/** Same rules as `POST /users` (`CreateFields`): trimmed, lowercased name. */
export function normalizeInitialAdmin(
    input: InitialAdminInput,
): InitialAdminInput {
    const username = input.username.trim().toLowerCase();
    if (!username) throw new BootstrapInputError('The username is empty.');
    if (username.length > STRING_LIMITS.USERNAME)
        throw new BootstrapInputError(
            `The username is longer than ${STRING_LIMITS.USERNAME} characters.`,
        );
    const { password } = input;
    if (
        password.length < STRING_LIMITS.PASSWORD_MIN ||
        password.length > STRING_LIMITS.PASSWORD
    )
        throw new BootstrapInputError(
            `The password must be ${STRING_LIMITS.PASSWORD_MIN} to ${STRING_LIMITS.PASSWORD} characters.`,
        );
    return { username, password };
}

function model<T>(
    connection: Connection,
    name: string,
    schema: Schema<T>,
): Model<T> {
    return (
        (connection.models[name] as Model<T> | undefined) ??
        connection.model<T>(name, schema)
    );
}

export interface BootstrapOptions {
    /** Test seam: runs inside the transaction, after every write. */
    beforeCommit?: (session: ClientSession) => Promise<void>;
}

export async function createInitialAdmin(
    connection: Connection,
    input: InitialAdminInput,
    options: BootstrapOptions = {},
): Promise<{ userId: string; username: string }> {
    const { username, password } = normalizeInitialAdmin(input);
    const users = model(connection, User.name, UserSchema);
    const audits = model(connection, AuditLog.name, AuditLogSchema);
    const markers = model(connection, 'SystemBootstrap', BootstrapMarkerSchema);
    // Collections and the unique name index exist before the transaction.
    for (const m of [users, audits, markers] as Model<unknown>[]) {
        await m.createCollection();
        await m.init();
    }
    if (
        (await markers.exists({ _id: INITIAL_ADMIN_MARKER })) ||
        (await users.exists({}))
    )
        throw new AlreadyInitializedError();

    const passwordHash = await argon.hash(password);
    const userId = new Types.ObjectId();
    try {
        await runInTransaction(async (session) => {
            // Inside the transaction too: a run that started in between
            // committed first.
            if (await users.exists({}).session(session))
                throw new AlreadyInitializedError();
            await markers.create(
                [
                    {
                        _id: INITIAL_ADMIN_MARKER,
                        user: userId,
                        createdAt: new Date(),
                    },
                ],
                { session },
            );
            await users.create(
                [
                    {
                        _id: userId,
                        name: username,
                        roles: [Role.Admin],
                        passwordHash,
                        isActive: true,
                        mustChangePassword: true,
                    },
                ],
                { session },
            );
            await audits.create(
                [
                    auditDocument({
                        actor: null,
                        action: AuditAction.SYSTEM_INITIAL_ADMIN_CREATED,
                        targetModel: 'User',
                        targetId: userId.toString(),
                        after: {
                            name: username,
                            roles: [Role.Admin],
                            isActive: true,
                            mustChangePassword: true,
                            source: BOOTSTRAP_SOURCE,
                        },
                    }),
                ],
                { session },
            );
            await options.beforeCommit?.(session);
        }, connection);
    } catch (err) {
        if (err instanceof AlreadyInitializedError) throw err;
        if (err instanceof AppError && err.code === ErrorCode.DB_DUPLICATE_KEY)
            throw new AlreadyInitializedError();
        throw err;
    }
    return { userId: userId.toString(), username };
}
