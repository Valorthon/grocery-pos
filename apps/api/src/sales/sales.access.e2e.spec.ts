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

interface SaleRow {
    _id: Types.ObjectId;
    cashier: Types.ObjectId;
    shift: Types.ObjectId;
    amount: number;
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

function sale(who: typeof SELLER_A, shift: Types.ObjectId, amount: number) {
    return {
        _id: new Types.ObjectId(),
        cashier: new Types.ObjectId(who.userId),
        shift,
        amount,
    };
}

const SALES: SaleRow[] = [
    sale(SELLER_A, OPEN_SHIFTS[SELLER_A.userId], 100),
    sale(SELLER_A, OPEN_SHIFTS[SELLER_A.userId], 200),
    sale(SELLER_B, OPEN_SHIFTS[SELLER_B.userId], 900),
    // A's sale from an earlier, closed shift.
    sale(SELLER_A, A_OLD_SHIFT, 300),
    sale(SELLER_C, new Types.ObjectId(), 400),
];
const [A_SALE, , B_SALE, A_OLD_SALE, C_SALE] = SALES;

function matches(row: SaleRow, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(
        ([key, expected]) =>
            String(row[key as keyof SaleRow]) === String(expected),
    );
}

const salesModel = {
    find: (filter: Record<string, unknown> = {}) => {
        const rows = SALES.filter((row) => matches(row, filter));
        const chain = {
            sort: () => chain,
            skip: () => chain,
            limit: () => chain,
            populate: () => chain,
            lean: () => Promise.resolve(rows),
        };
        return chain;
    },
    countDocuments: (filter: Record<string, unknown>) =>
        Promise.resolve(SALES.filter((row) => matches(row, filter)).length),
    estimatedDocumentCount: () => Promise.resolve(SALES.length),
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

    it('lists nothing for a seller with no open shift', async () => {
        const body = await list(SELLER_C);

        expect(body).toEqual({ data: [], totalItems: 0 });
    });

    it('lets an admin list every sale', async () => {
        const body = await list(ADMIN);

        expect(body.totalItems).toBe(SALES.length);
        expect(body.data).toHaveLength(SALES.length);
    });

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
});
