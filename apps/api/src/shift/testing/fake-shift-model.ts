/**
 * In-memory stand-ins for the Shift and Sales models and the Mongoose
 * connection, for ShiftService specs and the shifts access e2e spec.
 * Test-only: excluded from the build (tsconfig.build.json).
 *
 * Covers what ShiftService calls: `findOne` / `findById` / `find` (chained
 * with `sort`, `skip`, `limit`, `session`, `lean`), `create`,
 * `findOneAndUpdate` and `updateOne` with `$set`, `$inc` and `$push`,
 * `countDocuments` and `exists`. Filters are plain equality (compared as
 * strings, so ObjectIds match their hex). The unique partial index on open
 * shifts is enforced on `create`, with Mongo's duplicate-key error shape.
 * Transactions run one at a time and roll back on a throw; real snapshot
 * isolation and write conflicts need a real replica set.
 */
import { ClientSession, Types } from 'mongoose';
import { ShiftStatus } from '@grocery-pos/contracts';

type Row = Record<string, unknown> & { _id: Types.ObjectId };
type Filter = Record<string, unknown>;

function matches(row: Row, filter: Filter): boolean {
    return Object.entries(filter).every(
        ([key, expected]) => String(row[key]) === String(expected),
    );
}

/** Deep copy that keeps ObjectIds and Dates intact. */
function clone<T>(value: T): T {
    if (value instanceof Types.ObjectId) return value;
    if (value instanceof Date) return new Date(value) as T;
    if (Array.isArray(value)) return value.map(clone) as T;
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, clone(v)]),
        ) as T;
    }
    return value;
}

/** Chainable, awaitable query. */
class FakeQuery<T> implements PromiseLike<T> {
    private sortKey: string | null = null;
    private sortDir = 1;
    private skipN = 0;
    private limitN = Infinity;

    constructor(private readonly run: (q: FakeQuery<T>) => T) {}

    sort(spec: Record<string, number>): this {
        const [key, dir] = Object.entries(spec)[0];
        this.sortKey = key;
        this.sortDir = dir;
        return this;
    }
    skip(n: number): this {
        this.skipN = n;
        return this;
    }
    limit(n: number): this {
        this.limitN = n;
        return this;
    }
    session(): this {
        return this;
    }
    /** Applies sort/skip/limit to a list of rows. */
    page(rows: Row[]): Row[] {
        const key = this.sortKey;
        const sorted = key
            ? [...rows].sort(
                  (a, b) =>
                      (new Date(a[key] as Date).getTime() -
                          new Date(b[key] as Date).getTime()) *
                      this.sortDir,
              )
            : rows;
        return sorted.slice(this.skipN, this.skipN + this.limitN);
    }
    lean<R = T>(): Promise<R> {
        return Promise.resolve().then(() => this.run(this) as unknown as R);
    }
    then<A = T, B = never>(
        onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
        onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): Promise<A | B> {
        return this.lean<T>().then(onFulfilled, onRejected);
    }
}

function applyUpdate(
    row: Row,
    update: {
        $set?: Record<string, unknown>;
        $inc?: Record<string, number>;
        $push?: Record<string, unknown>;
    },
): void {
    for (const [key, value] of Object.entries(update.$set ?? {})) {
        row[key] = clone(value);
    }
    for (const [key, by] of Object.entries(update.$inc ?? {})) {
        row[key] = ((row[key] as number) ?? 0) + by;
    }
    for (const [key, value] of Object.entries(update.$push ?? {})) {
        row[key] = [...((row[key] as unknown[]) ?? []), clone(value)];
    }
}

function duplicateKey(field: string) {
    return Object.assign(new Error('E11000 duplicate key'), {
        name: 'MongoServerError',
        code: 11000,
        keyPattern: { [field]: 1 },
    });
}

export class FakeModel {
    rows: Row[] = [];

    constructor(private readonly onCreate?: (doc: Row, rows: Row[]) => void) {}

    seed(doc: Record<string, unknown>): Row {
        const row = { _id: new Types.ObjectId(), ...doc } as Row;
        this.rows.push(row);
        return row;
    }

    byId(id: Types.ObjectId | string): Row | undefined {
        return this.rows.find((row) => String(row._id) === String(id));
    }

    find(filter: Filter = {}): FakeQuery<Row[]> {
        return new FakeQuery((q) =>
            q.page(this.rows.filter((row) => matches(row, filter))).map(clone),
        );
    }

    findOne(filter: Filter): FakeQuery<Row | null> {
        return new FakeQuery((q) => {
            const [row] = q.page(this.rows.filter((r) => matches(r, filter)));
            return row ? clone(row) : null;
        });
    }

    findById(id: unknown): FakeQuery<Row | null> {
        return this.findOne({ _id: id });
    }

    exists(filter: Filter): FakeQuery<{ _id: Types.ObjectId } | null> {
        return new FakeQuery(() => {
            const row = this.rows.find((r) => matches(r, filter));
            return row ? { _id: row._id } : null;
        });
    }

    countDocuments(filter: Filter = {}): FakeQuery<number> {
        return new FakeQuery(
            () => this.rows.filter((row) => matches(row, filter)).length,
        );
    }

    create(doc: Record<string, unknown>) {
        const row = { _id: new Types.ObjectId(), ...clone(doc) } as Row;
        this.onCreate?.(row, this.rows);
        this.rows.push(row);
        return Promise.resolve({ ...clone(row), toObject: () => clone(row) });
    }

    findOneAndUpdate(
        filter: Filter,
        update: Parameters<typeof applyUpdate>[1],
    ): FakeQuery<Row | null> {
        return new FakeQuery(() => {
            const row = this.rows.find((r) => matches(r, filter));
            if (!row) return null;
            applyUpdate(row, update);
            return clone(row);
        });
    }

    updateOne(
        filter: Filter,
        update: Parameters<typeof applyUpdate>[1],
    ): Promise<{ matchedCount: number }> {
        const row = this.rows.find((r) => matches(r, filter));
        if (!row) return Promise.resolve({ matchedCount: 0 });
        applyUpdate(row, update);
        return Promise.resolve({ matchedCount: 1 });
    }
}

/** A Shift model with the one-open-shift-per-cashier unique index. */
export function fakeShiftModel(): FakeModel {
    return new FakeModel((doc, rows) => {
        if (
            doc.status === ShiftStatus.OPEN &&
            rows.some(
                (r) =>
                    r.status === ShiftStatus.OPEN &&
                    String(r.cashier) === String(doc.cashier),
            )
        ) {
            throw duplicateKey('cashier');
        }
    });
}

/**
 * Connection whose transactions run one at a time and restore every
 * model's rows when the callback throws.
 */
export function fakeConnection(...models: FakeModel[]) {
    let queue: Promise<unknown> = Promise.resolve();

    const startSession = () =>
        Promise.resolve({
            withTransaction: (fn: (s: ClientSession) => Promise<unknown>) => {
                const run = queue.then(async () => {
                    const snapshots = models.map((m) => m.rows.map(clone));
                    try {
                        return await fn({} as ClientSession);
                    } catch (err) {
                        models.forEach((m, i) => (m.rows = snapshots[i]));
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
