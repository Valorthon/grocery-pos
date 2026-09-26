/**
 * Wire drift (issue #27): real responses against the contracts wire types.
 *
 * The client types every response with a contracts type (`Receipt`,
 * `Paginated<SaleRow>`, `ZReadReport`, `DashboardView`, ...). The compiler
 * checks the API's services against those types (`asJson` in the
 * controllers), but it cannot see what a `.lean()` read or an aggregation
 * really returns, nor a field added to a schema. This suite drives the real
 * app over a real MongoDB and compares each body's keys with the type's
 * `WireShape` from contracts (`wireShapeDiff`): every required key present,
 * and no key the type does not name (Mongoose's `__v` aside). A shape is
 * checked by the compiler against its type, so a pass here means the JSON
 * has the keys of the type.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
    ADJUSTMENT_LINE_SHAPE,
    ADJUSTMENT_ROW_SHAPE,
    APP_ERROR_RESPONSE_SHAPE,
    COUNTED_AMOUNT_SHAPE,
    CURRENT_SHIFT_VIEW_SHAPE,
    DASHBOARD_MONEY_KEYS,
    DASHBOARD_VIEW_SHAPE,
    DiscountType,
    DRAWER_MOVEMENT_VIEW_SHAPE,
    DrawerMovementType,
    ErrorCode,
    INVENTORY_ROW_SHAPE,
    LOGIN_RESPONSE_SHAPE,
    PAGINATED_SHAPE,
    PRODUCT_MATCH_SHAPE,
    PRODUCT_REF_SHAPE,
    PRODUCT_VIEW_SHAPE,
    PROFILE_VIEW_SHAPE,
    RECEIPT_DISCOUNT_SHAPE,
    RECEIPT_ITEM_SHAPE,
    RECEIPT_SHAPE,
    RESTOCK_ACTIVITY_SHAPE,
    RESTOCK_LINE_SHAPE,
    RESTOCK_ROW_SHAPE,
    SALE_DISCOUNT_VIEW_SHAPE,
    SALE_LINE_SHAPE,
    SALE_REVERSAL_VIEW_SHAPE,
    SALE_ROW_SHAPE,
    SALE_VIEW_SHAPE,
    SHIFT_LIST_ITEM_SHAPE,
    USER_REF_SHAPE,
    USER_VIEW_SHAPE,
    Z_READ_DRAWER_SHAPE,
    Z_READ_REPORT_SHAPE,
    Z_READ_SALES_SHAPE,
    Z_READ_TENDERS_SHAPE,
    wireShapeDiff,
    type WireShape,
} from '@grocery-pos/contracts';
import { Role } from '../../src/auth/types';
import {
    bootDbApp,
    Caller,
    caller,
    cashSale,
    DbApp,
    FLOAT_COUNTS,
    openShift,
    read,
    seedProduct,
} from './db-app';

const PRICE = 4_550; // ₱45.50

let db: DbApp;
const admin = caller('admin', Role.Admin);
const seller = caller('seller', Role.Seller);
const restocker = caller('restocker', Role.Restocker, Role.Adjuster);

/**
 * Fails with the path and the key differences, e.g.
 * `{ at: 'GET /sales data[0]', missing: ['cashier'], unexpected: ['cashierId'] }`.
 */
function expectShape<T>(at: string, value: unknown, shape: WireShape<T>) {
    expect({ at, ...wireShapeDiff(value, shape) }).toEqual({
        at,
        missing: [],
        unexpected: [],
    });
}

/** The first element of a non-empty array (fails on an empty one). */
function first(at: string, value: unknown): unknown {
    expect({
        at,
        isNonEmptyArray: Array.isArray(value) && value.length > 0,
    }).toEqual({ at, isNonEmptyArray: true });
    return (value as unknown[])[0];
}

async function get(who: Caller, path: string) {
    const res = await read<Record<string, unknown>>(
        await db.call(who, 'GET', path),
    );
    expect({ path, status: res.status }).toEqual({ path, status: 200 });
    return res.body;
}

async function post(who: Caller, path: string, body: unknown) {
    const res = await read<Record<string, unknown>>(
        await db.call(who, 'POST', path, body),
    );
    expect({ path, status: res.status }).toEqual({ path, status: 201 });
    return res.body;
}

/** A paginated body: the page wrapper, then its first row. */
function firstRow<T>(at: string, body: unknown, shape: WireShape<T>) {
    expectShape(at, body, PAGINATED_SHAPE);
    const row = first(`${at} data`, (body as { data: unknown }).data);
    expectShape(`${at} data[0]`, row, shape);
    return row as Record<string, unknown>;
}

let product: string;
let saleId: string;

beforeAll(async () => {
    db = await bootDbApp();
    await Promise.all(
        ['Sales', 'Shift', 'Inventory', 'Product', 'User'].map((m) =>
            db.model(m).init(),
        ),
    );
    // Real accounts, so populated names (`cashier`, `restockedBy`, ...)
    // resolve to `{ _id, name }` rather than null.
    await db.model('User').create(
        [admin, seller, restocker].map((who) => ({
            _id: new Types.ObjectId(who.userId),
            name: who.username,
            roles: who.roles,
            passwordHash: 'not-a-real-hash',
            isActive: true,
        })),
    );
    product = await seedProduct(db, PRICE, 100);
    await openShift(db, admin);
});

afterAll(async () => {
    await db?.close();
});

describe('shifts and sales', () => {
    it('match CurrentShiftView, Receipt, SaleRow, SaleLine, SaleView and ZReadReport', async () => {
        // Open, with a cash in: CurrentShiftView and its movements.
        const opened = await post(seller, '/shifts', { counts: FLOAT_COUNTS });
        expectShape('POST /shifts', opened, CURRENT_SHIFT_VIEW_SHAPE);

        const drawer = await post(seller, '/shifts/current/drawer', {
            type: DrawerMovementType.CASH_IN,
            amount: 5_000,
            reason: 'Change',
        });
        expectShape(
            'POST /shifts/current/drawer',
            drawer,
            CURRENT_SHIFT_VIEW_SHAPE,
        );
        expectShape(
            'POST /shifts/current/drawer movements[0]',
            first('movements', drawer.movements),
            DRAWER_MOVEMENT_VIEW_SHAPE,
        );

        const current = await get(seller, '/shifts/current');
        expectShape('GET /shifts/current', current, {
            shift: 'required',
        } as const);
        expectShape(
            'GET /shifts/current shift',
            current.shift,
            CURRENT_SHIFT_VIEW_SHAPE,
        );

        // A discounted cash sale: the receipt and every nested part.
        const receipt = await post(seller, '/sales', {
            ...cashSale(product, 2, 2 * PRICE),
            discount: {
                type: DiscountType.PERCENT,
                value: 10,
                reason: 'Loyal',
            },
        });
        saleId = receipt._id as string;
        expectShape('POST /sales', receipt, RECEIPT_SHAPE);
        expectShape(
            'POST /sales items[0]',
            first('items', receipt.items),
            RECEIPT_ITEM_SHAPE,
        );
        expectShape(
            'POST /sales discount',
            receipt.discount,
            RECEIPT_DISCOUNT_SHAPE,
        );

        // The cashier's own list, then the admin's.
        const own = firstRow(
            'GET /sales (seller)',
            await get(seller, '/sales?page=1&limit=5'),
            SALE_ROW_SHAPE,
        );
        expectShape('GET /sales (seller) cashier', own.cashier, USER_REF_SHAPE);

        const row = firstRow(
            'GET /sales (admin)',
            await get(admin, '/sales?page=1&limit=5'),
            SALE_ROW_SHAPE,
        );
        expectShape('GET /sales (admin) cashier', row.cashier, USER_REF_SHAPE);
        expectShape(
            'GET /sales (admin) discount',
            row.discount,
            SALE_DISCOUNT_VIEW_SHAPE,
        );

        const lines = await read<unknown[]>(
            await db.call(seller, 'GET', `/sales/details/${saleId}`),
        );
        const line = first('GET /sales/details', lines.body);
        expectShape('GET /sales/details [0]', line, SALE_LINE_SHAPE);
        expectShape(
            'GET /sales/details [0] product',
            (line as { product: unknown }).product,
            PRODUCT_REF_SHAPE,
        );

        // Void, paid out of the seller's still-open shift.
        const voided = await post(admin, `/sales/${saleId}/void`, {
            reason: 'Mis-rung',
        });
        expectShape('POST /sales/:id/void', voided, SALE_VIEW_SHAPE);
        expectShape(
            'POST /sales/:id/void reversal',
            voided.reversal,
            SALE_REVERSAL_VIEW_SHAPE,
        );

        // Close: the Z-read, section by section.
        const report = await post(seller, '/shifts/current/close', {
            counts: FLOAT_COUNTS,
        });
        expectShape('POST /shifts/current/close', report, Z_READ_REPORT_SHAPE);
        expectShape('Z-read sales', report.sales, Z_READ_SALES_SHAPE);
        expectShape(
            'Z-read sales.voids',
            (report.sales as { voids: unknown }).voids,
            COUNTED_AMOUNT_SHAPE,
        );
        expectShape('Z-read tenders', report.tenders, Z_READ_TENDERS_SHAPE);
        expectShape('Z-read drawer', report.drawer, Z_READ_DRAWER_SHAPE);

        const last = await get(seller, '/shifts/last-closed');
        expectShape('GET /shifts/last-closed', last, {
            report: 'required',
        } as const);
        expectShape(
            'GET /shifts/last-closed report',
            last.report,
            Z_READ_REPORT_SHAPE,
        );

        const shift = firstRow(
            'GET /shifts',
            await get(admin, '/shifts?page=1&limit=5&status=CLOSED'),
            SHIFT_LIST_ITEM_SHAPE,
        );
        expectShape(
            'GET /shifts data[0] report',
            shift.report,
            Z_READ_REPORT_SHAPE,
        );
        expectShape(
            'GET /shifts/:id',
            await get(admin, `/shifts/${String(shift._id)}`),
            SHIFT_LIST_ITEM_SHAPE,
        );
    });
});

describe('products, stock and history', () => {
    it('match ProductView, ProductMatch, InventoryRow, restock and adjustment rows and lines', async () => {
        const productRow = firstRow(
            'GET /products',
            await get(restocker, '/products?page=1&limit=5'),
            PRODUCT_VIEW_SHAPE,
        );
        expectShape(
            'GET /products/:EAN',
            await get(seller, `/products/${String(productRow.EAN)}`),
            PRODUCT_VIEW_SHAPE,
        );
        const matches = await read<unknown[]>(
            await db.call(seller, 'GET', '/products/matches?name=item'),
        );
        expectShape(
            'GET /products/matches [0]',
            first('matches', matches.body),
            PRODUCT_MATCH_SHAPE,
        );

        const inventory = firstRow(
            'GET /inventories',
            await get(restocker, '/inventories?page=1&limit=5'),
            INVENTORY_ROW_SHAPE,
        );
        expectShape(
            'GET /inventories data[0] product',
            inventory.product,
            PRODUCT_VIEW_SHAPE,
        );

        // Restock: row, line (with its product) and the user filter list.
        await post(restocker, '/restocks', {
            description: 'Delivery',
            restockDetails: [{ product, quantity: 3, unitCost: 3_000 }],
        });
        const restock = firstRow(
            'GET /restocks',
            await get(restocker, '/restocks?page=1&limit=5'),
            RESTOCK_ROW_SHAPE,
        );
        expectShape(
            'GET /restocks data[0] restockedBy',
            restock.restockedBy,
            USER_REF_SHAPE,
        );
        const restockLine = firstRow(
            'GET /restocks/details',
            await get(
                restocker,
                `/restocks/details/${String(restock._id)}?page=1&limit=5`,
            ),
            RESTOCK_LINE_SHAPE,
        );
        expectShape(
            'GET /restocks/details data[0] product',
            restockLine.product,
            PRODUCT_VIEW_SHAPE,
        );
        const restockUsers = await read<unknown[]>(
            await db.call(restocker, 'GET', '/restocks/users'),
        );
        expectShape(
            'GET /restocks/users [0]',
            first('restock users', restockUsers.body),
            USER_REF_SHAPE,
        );

        // Adjustment: the same three.
        await post(restocker, '/adjustments', {
            description: 'Count',
            adjustDetails: [{ product, change: -1, reason: 'Damaged' }],
        });
        const adjustment = firstRow(
            'GET /adjustments',
            await get(restocker, '/adjustments?page=1&limit=5'),
            ADJUSTMENT_ROW_SHAPE,
        );
        expectShape(
            'GET /adjustments data[0] adjustedBy',
            adjustment.adjustedBy,
            USER_REF_SHAPE,
        );
        const adjustmentLine = firstRow(
            'GET /adjustments/details',
            await get(
                restocker,
                `/adjustments/details/${String(adjustment._id)}?page=1&limit=5`,
            ),
            ADJUSTMENT_LINE_SHAPE,
        );
        expectShape(
            'GET /adjustments/details data[0] product',
            adjustmentLine.product,
            PRODUCT_VIEW_SHAPE,
        );
        const adjustUsers = await read<unknown[]>(
            await db.call(restocker, 'GET', '/adjustments/users'),
        );
        expectShape(
            'GET /adjustments/users [0]',
            first('adjustment users', adjustUsers.body),
            USER_REF_SHAPE,
        );
    });
});

describe('dashboard', () => {
    it('matches DashboardView for an ADMIN, money included', async () => {
        const body = await get(admin, '/dashboard');
        expectShape('GET /dashboard (admin)', body, DASHBOARD_VIEW_SHAPE);
        for (const key of DASHBOARD_MONEY_KEYS) {
            expect({ key, sent: key in body }).toEqual({ key, sent: true });
        }
        const restock = first('recentRestocks', body.recentRestocks);
        expectShape('admin recentRestocks[0]', restock, RESTOCK_ACTIVITY_SHAPE);
        expect(restock).toHaveProperty('totalCost');
        expectShape(
            'admin recentSales[0]',
            first('recentSales', body.recentSales),
            SALE_ROW_SHAPE,
        );
        expectShape(
            'admin recentAdjustments[0]',
            first('recentAdjustments', body.recentAdjustments),
            ADJUSTMENT_ROW_SHAPE,
        );
    });

    it('matches DashboardView for anyone else, with no money key at all', async () => {
        const body = await get(restocker, '/dashboard');
        expectShape('GET /dashboard (restocker)', body, DASHBOARD_VIEW_SHAPE);
        for (const key of DASHBOARD_MONEY_KEYS) {
            expect({ key, sent: key in body }).toEqual({ key, sent: false });
        }
        const restock = first('recentRestocks', body.recentRestocks);
        expectShape(
            'restocker recentRestocks[0]',
            restock,
            RESTOCK_ACTIVITY_SHAPE,
        );
        expect(restock).not.toHaveProperty('totalCost');
    });
});

describe('users and auth', () => {
    it('match UserView, ProfileView and LoginResponse', async () => {
        const name = `cashier-${randomUUID().slice(0, 8)}`;
        const password = 'a-long-password';
        await post(admin, '/users', {
            users: [{ name, password, roles: [Role.Seller] }],
        });

        firstRow(
            'GET /users',
            await get(admin, '/users?page=1&limit=5'),
            USER_VIEW_SHAPE,
        );
        expectShape(
            'GET /users/profile',
            await get(seller, '/users/profile'),
            PROFILE_VIEW_SHAPE,
        );

        const login = await read(
            await db.call(seller, 'POST', '/auth/login', {
                username: name,
                password,
            }),
        );
        expect(login.status).toBe(201);
        expectShape('POST /auth/login', login.body, LOGIN_RESPONSE_SHAPE);
    });
});

describe('errors', () => {
    it('match AppErrorResponse for a 404, a 400 and a 409, with the ErrorCode', async () => {
        const missing = await read(
            await db.call(
                admin,
                'GET',
                `/sales/details/${new Types.ObjectId().toString()}`,
            ),
        );
        expect(missing.status).toBe(404);
        expectShape('404', missing.body, APP_ERROR_RESPONSE_SHAPE);
        expect(missing.body.error).toBe(ErrorCode.NOT_FOUND);

        const invalid = await read(
            await db.call(admin, 'GET', '/sales?page=0&limit=5'),
        );
        expect(invalid.status).toBe(400);
        expectShape('400', invalid.body, APP_ERROR_RESPONSE_SHAPE);
        expect(invalid.body.error).toBe(ErrorCode.VALIDATION_INVALID_INPUT);

        // The seller's shift closed above: selling now is SHIFT_NOT_OPEN.
        const conflict = await read(
            await db.call(
                seller,
                'POST',
                '/sales',
                cashSale(product, 1, PRICE, randomUUID()),
            ),
        );
        expect(conflict.status).toBe(409);
        expectShape('409', conflict.body, APP_ERROR_RESPONSE_SHAPE);
        expect(conflict.body.error).toBe(ErrorCode.SHIFT_NOT_OPEN);
    });
});
