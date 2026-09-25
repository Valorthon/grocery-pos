/**
 * In-memory stand-in for the RefreshToken model, for the refresh-token,
 * auth and users specs. Test-only: excluded from the build
 * (tsconfig.build.json).
 *
 * Covers exactly what RefreshTokenService calls: `create([doc])`,
 * `findById(id).populate().lean()`, `deleteOne(filter)` and
 * `deleteMany(filter)`, with the filters it builds (`_id`, `user`, `user:
 * {$in}`, `family: {$ne}`). `populate('user')` resolves through `users`,
 * returning `null` for an id it does not know, as Mongoose does for a
 * deleted user. `failNext` makes the next call of that method throw, like a
 * dropped connection.
 */
import { Types } from 'mongoose';
import { Role } from '../../types';

export interface StoredToken {
    _id: Types.ObjectId;
    user: Types.ObjectId;
    expiry: Date;
    family?: Types.ObjectId;
}

export interface TokenOwner {
    _id: Types.ObjectId;
    name: string;
    roles: Role[];
    isActive: boolean;
}

type Method = 'create' | 'findById' | 'deleteOne' | 'deleteMany';
type Filter = Record<string, unknown>;

const HOUR_MS = 3_600_000;

/** Ids and plain values compare by their string form, as in a filter. */
const str = (v: unknown): string =>
    v instanceof Types.ObjectId ? v.toHexString() : String(v);

function eq(a: unknown, b: unknown): boolean {
    return a !== undefined && b !== undefined && str(a) === str(b);
}

function matches(row: StoredToken, filter: Filter): boolean {
    return Object.entries(filter).every(([key, expected]) => {
        const actual = (row as unknown as Record<string, unknown>)[key];
        if (expected !== null && typeof expected === 'object') {
            if ('$in' in expected)
                return (expected.$in as unknown[]).some((v) => eq(v, actual));
            if ('$ne' in expected) return !eq(actual, expected.$ne);
        }
        return eq(actual, expected);
    });
}

export class FakeRefreshTokenModel {
    readonly rows = new Map<string, StoredToken>();
    /** Users that `populate('user')` can resolve, by id. */
    readonly users = new Map<string, TokenOwner>();
    failNext: Method | null = null;

    /** Resolves to `run()`, or rejects (asynchronously, like a query) on `failNext`. */
    private settle<T>(method: Method, run: () => T): Promise<T> {
        if (this.failNext === method) {
            this.failNext = null;
            return Promise.reject(
                new Error('MongoNetworkError: connection refused'),
            );
        }
        return Promise.resolve().then(run);
    }

    addUser(user: TokenOwner): TokenOwner {
        this.users.set(user._id.toString(), user);
        return user;
    }

    /** Stores a token directly, as a prior login would have. */
    seed(
        user: TokenOwner | Types.ObjectId,
        opts: { expiry?: Date; family?: Types.ObjectId | null } = {},
    ): string {
        const row: StoredToken = {
            _id: new Types.ObjectId(),
            user: user instanceof Types.ObjectId ? user : user._id,
            expiry: opts.expiry ?? new Date(Date.now() + HOUR_MS),
            ...(opts.family === null
                ? {}
                : { family: opts.family ?? new Types.ObjectId() }),
        };
        this.rows.set(row._id.toString(), row);
        return row._id.toString();
    }

    tokensOf(user: TokenOwner | Types.ObjectId): StoredToken[] {
        const id = user instanceof Types.ObjectId ? user : user._id;
        return [...this.rows.values()].filter((row) => row.user.equals(id));
    }

    create = jest.fn(
        (docs: { user: string; expiry: Date; family: string }[]) => {
            return this.settle('create', () =>
                docs.map((doc) => {
                    const row: StoredToken = {
                        _id: new Types.ObjectId(),
                        user: new Types.ObjectId(doc.user),
                        expiry: doc.expiry,
                        family: new Types.ObjectId(doc.family),
                    };
                    this.rows.set(row._id.toString(), row);
                    return row;
                }),
            );
        },
    );

    findById = jest.fn((id: string) => {
        const run = () => {
            const row = this.rows.get(String(id));
            return row
                ? { ...row, user: this.users.get(row.user.toString()) ?? null }
                : null;
        };
        return {
            populate: () => ({ lean: () => this.settle('findById', run) }),
        };
    });

    deleteOne = jest.fn((filter: Filter) => {
        return this.settle('deleteOne', () => {
            const hit = [...this.rows.values()].find((row) =>
                matches(row, filter),
            );
            if (hit) this.rows.delete(hit._id.toString());
            return { deletedCount: hit ? 1 : 0 };
        });
    });

    deleteMany = jest.fn((filter: Filter) => {
        return this.settle('deleteMany', () => {
            const hits = [...this.rows.values()].filter((row) =>
                matches(row, filter),
            );
            for (const hit of hits) this.rows.delete(hit._id.toString());
            return { deletedCount: hits.length };
        });
    });
}
