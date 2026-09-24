/**
 * In-memory stand-in for the User model and the Mongoose connection, for
 * UserService specs and the users e2e spec. Test-only: excluded from the
 * build (tsconfig.build.json).
 *
 * Covers exactly what UserService calls: `find`, `findById`, `findOne`
 * (chained with `select`/`session`/`lean`), `countDocuments`, `updateOne`,
 * `updateMany` and `insertMany`. Transactions are serialized and roll back
 * on a throw, so a refused bulk update leaves the rows untouched. Real
 * snapshot isolation (and the write-skew guard) needs a real replica set.
 */
import { ASSIGNABLE_ROLES } from '@grocery-pos/contracts';
import { ClientSession, Types } from 'mongoose';
import { Role } from '../../auth/types';

export interface FakeUserRow {
    _id: Types.ObjectId;
    name: string;
    roles: Role[];
    passwordHash: string;
    isActive: boolean;
    updatedAt?: Date;
}

type Filter = Record<string, unknown>;

export interface WriteCall {
    op: 'updateOne' | 'updateMany' | 'insertMany';
    filter?: Filter;
    update?: unknown;
    options?: Record<string, unknown>;
}

function matches(row: FakeUserRow, filter: Filter): boolean {
    return Object.entries(filter).every(([key, expected]) => {
        const actual = (row as unknown as Record<string, unknown>)[key];
        if (
            expected !== null &&
            typeof expected === 'object' &&
            '$in' in expected
        ) {
            return (expected.$in as unknown[])
                .map(String)
                .includes(String(actual));
        }
        if (Array.isArray(actual)) return actual.includes(expected);
        return String(actual) === String(expected);
    });
}

const clone = (row: FakeUserRow): FakeUserRow => ({
    ...row,
    roles: [...row.roles],
});

/** Chainable, awaitable query: `.select().session().lean()` or `await`. */
class FakeQuery<T> implements PromiseLike<T> {
    constructor(private readonly run: () => T) {}
    select(): this {
        return this;
    }
    session(): this {
        return this;
    }
    lean(): Promise<T> {
        return Promise.resolve().then(this.run);
    }
    then<A = T, B = never>(
        onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
        onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): Promise<A | B> {
        return this.lean().then(onFulfilled, onRejected);
    }
}

export class FakeUserModel {
    rows: FakeUserRow[] = [];
    readonly writes: WriteCall[] = [];

    seed(user: Partial<FakeUserRow> & { name: string }): FakeUserRow {
        const row: FakeUserRow = {
            _id: new Types.ObjectId(),
            roles: [Role.Seller],
            passwordHash: 'unused',
            isActive: true,
            ...user,
        };
        this.rows.push(row);
        return row;
    }

    byId(id: Types.ObjectId | string): FakeUserRow | undefined {
        return this.rows.find((row) => row._id.equals(id));
    }

    find(filter: Filter): FakeQuery<FakeUserRow[]> {
        return new FakeQuery(() =>
            this.rows.filter((row) => matches(row, filter)).map(clone),
        );
    }

    findOne(filter: Filter): FakeQuery<FakeUserRow | null> {
        return new FakeQuery(() => {
            const row = this.rows.find((r) => matches(r, filter));
            return row ? clone(row) : null;
        });
    }

    findById(id: string): FakeQuery<FakeUserRow | null> {
        return this.findOne({ _id: id });
    }

    countDocuments(filter: Filter): FakeQuery<number> {
        return new FakeQuery(
            () => this.rows.filter((row) => matches(row, filter)).length,
        );
    }

    updateOne(
        filter: Filter,
        update: { $set: Record<string, unknown> },
        options: Record<string, unknown> = {},
    ): Promise<{ matchedCount: number }> {
        this.writes.push({ op: 'updateOne', filter, update, options });
        const row = this.rows.find((r) => matches(r, filter));
        if (!row) return Promise.resolve({ matchedCount: 0 });
        if (options.runValidators) this.validate(update.$set);
        Object.assign(row, update.$set);
        return Promise.resolve({ matchedCount: 1 });
    }

    updateMany(
        filter: Filter,
        update: { $set: Record<string, unknown> },
        options: Record<string, unknown> = {},
    ): Promise<{ matchedCount: number }> {
        this.writes.push({ op: 'updateMany', filter, update, options });
        const hit = this.rows.filter((r) => matches(r, filter));
        hit.forEach((row) => Object.assign(row, update.$set));
        return Promise.resolve({ matchedCount: hit.length });
    }

    insertMany(
        docs: Omit<FakeUserRow, '_id' | 'isActive'>[],
        options: Record<string, unknown> = {},
    ): Promise<FakeUserRow[]> {
        this.writes.push({ op: 'insertMany', update: docs, options });
        for (const doc of docs) this.validate(doc);
        return Promise.resolve(docs.map((doc) => this.seed(doc)));
    }

    /** The schema's role enum, as `runValidators` would enforce it. */
    private validate(fields: Record<string, unknown>): void {
        const roles = fields.roles as string[] | undefined;
        if (roles?.some((r) => !ASSIGNABLE_ROLES.includes(r as Role))) {
            throw new Error('ValidationError: roles');
        }
    }
}

/**
 * Connection whose transactions run one at a time and restore the rows when
 * the callback throws.
 */
export function fakeConnection(model: FakeUserModel) {
    let queue: Promise<unknown> = Promise.resolve();

    const startSession = () =>
        Promise.resolve({
            withTransaction: (fn: (s: ClientSession) => Promise<unknown>) => {
                const run = queue.then(async () => {
                    const snapshot = model.rows.map(clone);
                    try {
                        return await fn({} as ClientSession);
                    } catch (err) {
                        model.rows = snapshot;
                        throw err;
                    }
                });
                queue = run.catch(() => undefined);
                return run;
            },
            endSession: () => Promise.resolve(),
        });

    return { startSession };
}
