/**
 * Cashier scoping of the sales history, over real HTTP (issues #13, #2). The
 * real SalesController and SalesService run behind the real guards and
 * filter; the Sales and SalesDetails models are in-memory fakes that apply
 * the `cashier`, `shift` and `_id` filters the service sends, and
 * ShiftService answers each cashier's open shift from a fixed table.
 */
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Role } from '../auth/types';
import { ErrorCode } from '../common/errors';
import {
    AccessHarness,
    ALL_ROLES,
    bootAccessHarness,
    caller,
} from '../common/testing/access-harness';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { ProductService } from '../product/product.service';
import { SalesController } from './sales.controller';
import { SalesDetails } from './sales-details.schema';
import { Sales } from './sales.schema';
import { SalesService } from './sales.service';
import { ShiftService } from '../shift/shift.service';
import { PAGINATION } from '../constants';

interface SaleRow {
    _id: Types.ObjectId;
    cashier: Types.ObjectId;
    shift: Types.ObjectId;
    amount: number;
    createdAt: Date;
    idempotencyKey: string;
    requestHash: string;
    reversal?: {
        type: string;
        payoutShift?: Types.ObjectId;
        payoutAmount?: number;
    };
}

const SELLER_A = caller(Role.Seller);
const SELLER_B = caller(Role.Seller);
/** A cashier with sales from a closed shift and no open one. */
const SELLER_C = caller(Role.Seller);
const ADMIN = caller(Role.Admin);

const A_OLD_SHIFT = new Types.ObjectId();
const OPEN_SHIFTS: Record<string, Types.ObjectId> = {
    [SELLER_A.userId]: new Types.ObjectId(),
    [SELLER_B.userId]: new Types.ObjectId(),
};

function sale(
    who: typeof SELLER_A,
    shift: Types.ObjectId,
    amount: number,
    createdAt: string,
) {
    return {
        _id: new Types.ObjectId(),
        cashier: new Types.ObjectId(who.userId),
        shift,
        amount,
        createdAt: new Date(createdAt),
        // Stored for replays of POST /sales; never listed (#27).
        idempotencyKey: `key-${createdAt}`,
        requestHash: `hash-${createdAt}`,
    };
}

const SALES: SaleRow[] = [
    // 23:59:59 on 2026-09-24 in Manila (UTC+8)...
    sale(SELLER_A, OPEN_SHIFTS[SELLER_A.userId], 100, '2026-09-24T15:59:59Z'),
    // ...and one second later, 00:00:00 on 2026-09-25 in Manila.
    sale(SELLER_A, OPEN_SHIFTS[SELLER_A.userId], 200, '2026-09-24T16:00:00Z'),
    sale(SELLER_B, OPEN_SHIFTS[SELLER_B.userId], 900, '2026-09-25T03:00:00Z'),
    // A's sale from an earlier, closed shift.
    sale(SELLER_A, A_OLD_SHIFT, 300, '2026-09-20T02:00:00Z'),
    sale(SELLER_C, new Types.ObjectId(), 400, '2026-09-10T02:00:00Z'),
];
const [A_SALE, A_REFUNDED, B_SALE, A_OLD_SALE, C_SALE] = SALES;
// Refunded, with the cash paid back from another cashier's drawer.
A_REFUNDED.reversal = {
    type: 'REFUND',
    payoutShift: OPEN_SHIFTS[SELLER_B.userId],
    payoutAmount: 200,
};

type Range = { $gte?: Date; $lt?: Date };

function isRange(value: unknown): value is Range {
    return (
        typeof value === 'object' &&
        value !== null &&
        ('$gte' in value || '$lt' in value)
    );
}

/** Equality on ids and numbers, and `$gte`/`$lt` on dates, as Mongo would. */
function matches(row: SaleRow, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, expected]) => {
        const actual = row[key as keyof SaleRow];
        if (isRange(expected)) {
            const t = (actual as Date).getTime();
            return (
                (!expected.$gte || t >= expected.$gte.getTime()) &&
                (!expected.$lt || t < expected.$lt.getTime())
            );
        }
        return String(actual as Types.ObjectId | number) === String(expected);
    });
}

/** Applies an exclusion projection of dotted paths, as Mongo would. */
function project(row: SaleRow, projection?: Record<string, 0>): SaleRow {
    const copy = {
        ...row,
        reversal: row.reversal && { ...row.reversal },
    } as unknown as Record<string, unknown>;
    for (const path of Object.keys(projection ?? {})) {
        const keys = path.split('.');
        const last = keys.pop()!;
        const parent = keys.reduce<Record<string, unknown> | undefined>(
            (obj, key) => obj?.[key] as Record<string, unknown> | undefined,
            copy,
        );
        if (parent) delete parent[last];
    }
    return copy as unknown as SaleRow;
}

const salesModel = {
    find: (
        filter: Record<string, unknown> = {},
        projection?: Record<string, 0>,
    ) => {
        const rows = SALES.filter((row) => matches(row, filter)).map((row) =>
            project(row, projection),
        );
        const chain = {
            sort: () => chain,
            skip: () => chain,
            limit: () => chain,
            populate: () => chain,
            lean: () => Promise.resolve(rows),
        };
        return chain;
    },
    // No estimatedDocumentCount: every total is an exact count (#16).
    countDocuments: (filter: Record<string, unknown>) =>
        Promise.resolve(SALES.filter((row) => matches(row, filter)).length),
    exists: (filter: Record<string, unknown>) => {
        const row = SALES.find((r) => matches(r, filter));
        return Promise.resolve(row ? { _id: row._id } : null);
    },
};

const detailsModel = {
    find: ({ sales }: { sales: string }) => ({
        populate: () => ({
            lean: () =>
                Promise.resolve([
                    { sales, product: { name: 'milk' }, quantity: 1 },
                ]),
        }),
    }),
};

describe('Sales history scoping (e2e)', () => {
    let harness: AccessHarness;

    beforeAll(async () => {
        harness = await bootAccessHarness(
            [SalesController],
            [
                SalesService,
                { provide: getConnectionToken(), useValue: {} },
                { provide: getModelToken(Sales.name), useValue: salesModel },
                {
                    provide: getModelToken(SalesDetails.name),
                    useValue: detailsModel,
                },
                { provide: ProductService, useValue: {} },
                { provide: InventoryService, useValue: {} },
                {
                    provide: ShiftService,
                    useValue: {
                        openShiftIdOf: (cashier: string) =>
                            Promise.resolve(OPEN_SHIFTS[cashier] ?? null),
                    },
                },
            ],
        );
    });

    afterAll(async () => {
        await harness.close();
    });

    async function list(who: typeof SELLER_A) {
        const res = await harness.call(who, 'GET', '/sales?page=1&limit=10');
        expect(res.status).toBe(200);
        return (await res.json()) as {
            data: Array<{ _id: string; cashier: string }>;
            totalItems: number;
        };
    }

    it('lists only the seller’s own sales in their open shift, and counts only those', async () => {
        const body = await list(SELLER_A);

        expect(body.totalItems).toBe(2);
        expect(body.data.map((s) => s.cashier)).toEqual([
            SELLER_A.userId,
            SELLER_A.userId,
        ]);
    });

    it('never lists another seller’s sale', async () => {
        const body = await list(SELLER_B);

        expect(body.data.map((s) => s._id)).toEqual([String(B_SALE._id)]);
        expect(body.totalItems).toBe(1);
    });

    it('scopes a manager who also sells to their own sales', async () => {
        const body = await list({
            userId: SELLER_A.userId,
            roles: [Role.Seller, Role.Restocker, Role.UserManager],
        });

        expect(body.totalItems).toBe(2);
    });

    it('never lists the seller’s sales from an earlier shift', async () => {
        const body = await list(SELLER_A);

        expect(body.data.map((s) => s._id)).not.toContain(
            String(A_OLD_SALE._id),
        );
    });

    it('hides which shift paid a reversal back, and how much, from a seller (#2)', async () => {
        const res = await harness.call(
            SELLER_A,
            'GET',
            '/sales?page=1&limit=10',
        );
        const body = (await res.json()) as {
            data: Array<{ _id: string; reversal?: Record<string, unknown> }>;
        };
        const refunded = body.data.find(
            (s) => s._id === String(A_REFUNDED._id),
        );

        expect(refunded?.reversal).toEqual({ type: 'REFUND' });
    });

    it('shows an admin which shift paid a reversal back', async () => {
        const res = await harness.call(ADMIN, 'GET', '/sales?page=1&limit=10');
        const body = (await res.json()) as {
            data: Array<{ _id: string; reversal?: Record<string, unknown> }>;
        };
        const refunded = body.data.find(
            (s) => s._id === String(A_REFUNDED._id),
        );

        expect(refunded?.reversal).toMatchObject({
            payoutShift: String(OPEN_SHIFTS[SELLER_B.userId]),
            payoutAmount: 200,
        });
    });

    it('lists nothing for a seller with no open shift', async () => {
        const body = await list(SELLER_C);

        expect(body).toEqual({ data: [], totalItems: 0 });
    });

    it('lets an admin list every sale', async () => {
        const body = await list(ADMIN);

        expect(body.totalItems).toBe(SALES.length);
        expect(body.data).toHaveLength(SALES.length);
    });

    it.each([
        ['an admin', ADMIN],
        ['a seller', SELLER_A],
    ])(
        'never lists the idempotency key or request hash to %s (#27)',
        async (_label, who) => {
            const body = await list(who);

            expect(body.data.length).toBeGreaterThan(0);
            for (const row of body.data) {
                expect(row).not.toHaveProperty('idempotencyKey');
                expect(row).not.toHaveProperty('requestHash');
            }
        },
    );

    it('shows a seller the details of their own sale', async () => {
        const res = await harness.call(
            SELLER_A,
            'GET',
            `/sales/details/${String(A_SALE._id)}`,
        );

        expect(res.status).toBe(200);
        expect(await res.json()).toHaveLength(1);
    });

    it('answers another seller’s sale with 404, as if it did not exist', async () => {
        const other = await harness.call(
            SELLER_A,
            'GET',
            `/sales/details/${String(B_SALE._id)}`,
        );
        const missing = await harness.call(
            SELLER_A,
            'GET',
            `/sales/details/${new Types.ObjectId().toString()}`,
        );

        expect(other.status).toBe(404);
        expect(missing.status).toBe(404);
        const [a, b] = (await Promise.all([other.json(), missing.json()])) as [
            Record<string, unknown>,
            Record<string, unknown>,
        ];
        expect(a.error).toBe(ErrorCode.NOT_FOUND);
        expect(a.message).toBe(b.message);
    });

    it('answers the seller’s own sale from an earlier shift with 404', async () => {
        const res = await harness.call(
            SELLER_A,
            'GET',
            `/sales/details/${String(A_OLD_SALE._id)}`,
        );

        expect(res.status).toBe(404);
    });

    it('answers every sale with 404 for a seller with no open shift', async () => {
        const res = await harness.call(
            SELLER_C,
            'GET',
            `/sales/details/${String(C_SALE._id)}`,
        );

        expect(res.status).toBe(404);
    });

    it('lets an admin read any sale’s details', async () => {
        const res = await harness.call(
            ADMIN,
            'GET',
            `/sales/details/${String(B_SALE._id)}`,
        );

        expect(res.status).toBe(200);
    });

    it.each(ALL_ROLES.map((role) => [role, role === Role.Admin] as const))(
        'void and refund as %s -> allowed: %s',
        async (role, allowed) => {
            const who = caller(role);
            for (const action of ['void', 'refund']) {
                const res = await harness.call(
                    who,
                    'POST',
                    `/sales/${new Types.ObjectId().toString()}/${action}`,
                    { reason: 'mis-ring' },
                );
                // An allowed caller reaches the service, which fails on the
                // empty fake connection; a refused one never gets there.
                if (allowed) expect(res.status).not.toBe(403);
                else expect(res.status).toBe(403);
            }
        },
    );

    it.each([Role.Restocker, Role.Adjuster, Role.UserManager])(
        'refuses the sales history to %s without SELLER',
        async (role) => {
            const res = await harness.call(
                caller(role),
                'GET',
                '/sales?page=1&limit=10',
            );
            expect(res.status).toBe(403);
        },
    );
    describe('filters (#16)', () => {
        async function listWith(who: typeof SELLER_A, query: string) {
            const res = await harness.call(
                who,
                'GET',
                `/sales?page=1&limit=10&${query}`,
            );
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                data: Array<{ _id: string }>;
                totalItems: number;
            };
            return {
                ids: body.data.map((s) => s._id).sort(),
                totalItems: body.totalItems,
            };
        }

        const ids = (...rows: SaleRow[]) =>
            rows.map((row) => String(row._id)).sort();

        it('filters an admin’s list by cashier across all shifts', async () => {
            const body = await listWith(ADMIN, `cashier=${SELLER_A.userId}`);

            expect(body.ids).toEqual(ids(A_SALE, A_REFUNDED, A_OLD_SALE));
            expect(body.totalItems).toBe(3);
        });

        it('filters an admin’s list by Manila day, across all cashiers', async () => {
            const today = await listWith(
                ADMIN,
                'dateFrom=2026-09-25&dateTo=2026-09-25',
            );
            const before = await listWith(ADMIN, 'dateTo=2026-09-24');

            // 16:00:00Z on the 24th is already the 25th in Manila;
            // 15:59:59Z is still the 24th.
            expect(today.ids).toEqual(ids(A_REFUNDED, B_SALE));
            expect(today.totalItems).toBe(2);
            expect(before.ids).toEqual(ids(A_SALE, A_OLD_SALE, C_SALE));
        });

        it('combines the cashier and date filters for an admin', async () => {
            const body = await listWith(
                ADMIN,
                `cashier=${SELLER_A.userId}&dateFrom=2026-09-21`,
            );

            expect(body.ids).toEqual(ids(A_SALE, A_REFUNDED));
        });

        it('returns nothing, not the other cashier’s sales, when a seller names someone else', async () => {
            const body = await listWith(SELLER_A, `cashier=${SELLER_B.userId}`);

            expect(body).toEqual({ ids: [], totalItems: 0 });
        });

        it('keeps a seller inside their open shift when they name themselves', async () => {
            const body = await listWith(SELLER_A, `cashier=${SELLER_A.userId}`);

            expect(body.ids).toEqual(ids(A_SALE, A_REFUNDED));
        });

        it('lets a date filter only narrow a seller’s current shift', async () => {
            const today = await listWith(SELLER_A, 'dateFrom=2026-09-25');
            const earlier = await listWith(
                SELLER_A,
                'dateFrom=2026-09-01&dateTo=2026-09-20',
            );

            expect(today.ids).toEqual(ids(A_REFUNDED));
            // A's sale on the 20th is from a closed shift: still hidden.
            expect(earlier).toEqual({ ids: [], totalItems: 0 });
        });

        it.each([
            ['a malformed cashier id', 'cashier=ana'],
            ['an impossible date', 'dateFrom=2026-02-30'],
            ['a date in another format', 'dateTo=25/09/2026'],
        ])('refuses %s with a 400', async (_, query) => {
            const res = await harness.call(
                ADMIN,
                'GET',
                `/sales?page=1&limit=10&${query}`,
            );

            expect(res.status).toBe(400);
        });
    });

    describe('pagination cap (#16)', () => {
        it('accepts a page of PAGINATION.LIMIT_MAX rows', async () => {
            const res = await harness.call(
                ADMIN,
                'GET',
                `/sales?page=1&limit=${PAGINATION.LIMIT_MAX}`,
            );

            expect(res.status).toBe(200);
        });

        it.each([
            ['a fractional page', 'page=1.5&limit=10'],
            [
                'a page past PAGE_MAX',
                `page=${PAGINATION.PAGE_MAX + 1}&limit=10`,
            ],
            ['page=1e20', 'page=1e20&limit=10'],
            ['a fractional limit', 'page=1&limit=2.5'],
        ])('refuses %s with a 400', async (_, query) => {
            const res = await harness.call(ADMIN, 'GET', `/sales?${query}`);

            expect(res.status).toBe(400);
        });

        it.each([PAGINATION.LIMIT_MAX + 1, 1_000_000])(
            'refuses limit=%s with a 400',
            async (limit) => {
                const res = await harness.call(
                    ADMIN,
                    'GET',
                    `/sales?page=1&limit=${limit}`,
                );

                expect(res.status).toBe(400);
            },
        );
    });
});
