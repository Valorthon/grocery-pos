/**
 * Wire drift (issue #27): real responses against the contracts wire types.
 *
 * The client types every response with a contracts type (`Receipt`,
 * `Paginated<SaleRow>`, `ZReadReport`, `DashboardView`, ...). The compiler
 * checks the API's services against those types (`asJson` in the
 * controllers), but it cannot see what a `.lean()` read or an aggregation
 * really returns, nor a field added to a schema. This suite drives the real
 * app over a real MongoDB and compares each body, its nested objects and
 * every element of its arrays with the type's `WireShape` from contracts
 * (`wireShapeDiff`): every required key present, and no key the type does
 * not name (Mongoose's `__v` aside). A shape is checked by the compiler
 * against its type, so a pass here means the JSON has the keys of the type.
 *
 * On top of the keys, `expectValueKinds` checks the values the contracts
 * promise by name everywhere: every `_id` is an ObjectId string, every
 * timestamp an ISO string, every money figure an integer (centavos).
 * Whether a reference is populated (an object) or an id (a string) depends
 * on the route, so those are asserted where each one is read.
 *
 * `beforeAll` seeds one store through the API (shifts, sales, a void, a
 * refund, a close, a force-close, a restock, an adjustment, a user) and
 * keeps the write responses; each test then checks its own routes, so one
 * failing check does not take the others down with it.
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
    LOGIN_USER_SHAPE,
    PAGINATED_SHAPE,
    PaymentType,
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
    TENDER_SHAPE,
    TenderType,
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
/** Keys the product owner ruled out of every sale response (#27). */
const INTERNAL_SALE_KEYS = ['idempotencyKey', 'requestHash'];

type Body = Record<string, unknown>;

let db: DbApp;
const admin = caller('admin', Role.Admin);
/** Rings sales into a shift that stays open. */
const seller = caller('seller', Role.Seller);
/** Closes their own shift. */
const closer = caller('closer', Role.Seller);
/** Has their shift force-closed by the admin. */
const absentee = caller('absentee', Role.Seller);
const restocker = caller('restocker', Role.Restocker, Role.Adjuster);

/** Write responses kept by the seed, each checked by its own test. */
const seed = {} as {
    product: string;
    opened: Body;
    drawer: Body;
    receipt: Body;
    splitReceipt: Body;
    voided: Body;
    refunded: Body;
    closedReport: Body;
    forcedReport: Body;
    login: { status: number; body: Body };
};

// ---------------------------------------------------------------- helpers

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

/** Every element of a non-empty array against `shape`. */
function expectEach<T>(at: string, value: unknown, shape: WireShape<T>) {
    expect({
        at,
        isNonEmptyArray: Array.isArray(value) && value.length > 0,
    }).toEqual({ at, isNonEmptyArray: true });
    (value as unknown[]).forEach((item, i) =>
        expectShape(`${at}[${i}]`, item, shape),
    );
    return value as Body[];
}

/** A populated `{ _id, name }` reference, not an id string. */
function expectRef(at: string, value: unknown) {
    expectShape(at, value, USER_REF_SHAPE);
}

/** An id, not a populated object. */
function expectId(at: string, value: unknown) {
    const isId = typeof value === 'string' && OBJECT_ID.test(value);
    expect({ at, isId, value }).toEqual({ at, isId: true, value });
}

const OBJECT_ID = /^[0-9a-f]{24}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE_KEYS = new Set([
    'createdAt',
    'updatedAt',
    'at',
    'openedAt',
    'closedAt',
    'timestamp',
]);
/** Keys that hold centavos (or a count of pieces) wherever they appear. */
const INTEGER_KEYS = new Set([
    'amount',
    'totalAmount',
    'subtotal',
    'price',
    'unitPrice',
    'unitCost',
    'totalCost',
    'changeGiven',
    'amountTendered',
    'openingFloat',
    'payoutAmount',
    'todayRevenue',
    'gross',
    'net',
    'cash',
    'gcash',
    'cashIn',
    'cashDrops',
    'expectedCash',
    'countedCash',
    'overShort',
    'count',
    'quantity',
    'stock',
    'change',
    'totalItems',
    'statusCode',
]);

/**
 * Walks `value` and lists every value of the wrong kind: an `_id` that is
 * not an ObjectId string, a timestamp that is not an ISO string (a closed
 * shift's `closedAt` may be null), a money or count key that is not an
 * integer.
 */
function valueKindProblems(value: unknown, path: string): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((item, i) =>
            valueKindProblems(item, `${path}[${i}]`),
        );
    }
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([key, v]) => {
        const at = `${path}.${key}`;
        if (key === '_id' && !(typeof v === 'string' && OBJECT_ID.test(v))) {
            return [`${at} is not an id string: ${JSON.stringify(v)}`];
        }
        if (
            DATE_KEYS.has(key) &&
            !(typeof v === 'string' && ISO.test(v)) &&
            !(key === 'closedAt' && v === null)
        ) {
            return [`${at} is not an ISO timestamp: ${JSON.stringify(v)}`];
        }
        if (INTEGER_KEYS.has(key) && !Number.isInteger(v)) {
            return [`${at} is not an integer: ${JSON.stringify(v)}`];
        }
        return valueKindProblems(v, at);
    });
}

function expectValueKinds(at: string, value: unknown) {
    expect(valueKindProblems(value, at)).toEqual([]);
}

/** Checks a sale response never carries the checkout internals (#27). */
function expectNoInternals(at: string, sale: unknown) {
    for (const key of INTERNAL_SALE_KEYS) {
        expect({ at, key, sent: key in (sale as Body) }).toEqual({
            at,
            key,
            sent: false,
        });
    }
}

async function send(
    who: Caller,
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    status: number,
): Promise<Body> {
    const res = await read<Body>(await db.call(who, method, path, body));
    // Thrown, not expected: a seed step that fails should say which one.
    if (res.status !== status) {
        throw new Error(
            `${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`,
        );
    }
    expectValueKinds(`${method} ${path}`, res.body);
    return res.body;
}

const get = (who: Caller, path: string) =>
    send(who, 'GET', path, undefined, 200);
const post = (who: Caller, path: string, body: unknown) =>
    send(who, 'POST', path, body, 201);

/** A paginated body: the page wrapper, then every row. */
async function page<T>(who: Caller, path: string, shape: WireShape<T>) {
    const body = await get(who, path);
    expectShape(`GET ${path}`, body, PAGINATED_SHAPE);
    return expectEach(`GET ${path} data`, body.data, shape);
}

/** A GCash reference: 13 digits, unique per call. */
let refSeq = 0;
function nextReference(): string {
    refSeq++;
    return (
        `${Date.now() % 1e9}`.padStart(9, '0') + String(refSeq).padStart(4, '0')
    );
}

// ---------------------------------------------------------------- seed

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
        [admin, seller, closer, absentee, restocker].map((who) => ({
            _id: new Types.ObjectId(who.userId),
            name: who.username,
            roles: who.roles,
            passwordHash: 'not-a-real-hash',
            isActive: true,
        })),
    );
    const product = await seedProduct(db, PRICE, 1_000);
    seed.product = product;

    // The seller: open, cash in, a discounted split sale, two cash sales
    // (one voided, one refunded). The shift stays open.
    seed.opened = await post(seller, '/shifts', { counts: FLOAT_COUNTS });
    seed.drawer = await post(seller, '/shifts/current/drawer', {
        type: DrawerMovementType.CASH_IN,
        amount: 5_000,
        reason: 'Change',
    });
    const total = 2 * PRICE - Math.round((2 * PRICE) / 10);
    seed.splitReceipt = await post(seller, '/sales', {
        idempotencyKey: randomUUID(),
        paymentType: PaymentType.SPLIT,
        referenceNumber: nextReference(),
        tenders: [
            { type: TenderType.CASH, amount: 5_000 },
            { type: TenderType.GCASH, amount: total - 5_000 },
        ],
        sellDetails: [{ product, quantity: 2 }],
        discount: { type: DiscountType.PERCENT, value: 10, reason: 'Loyal' },
    });
    seed.receipt = await post(seller, '/sales', {
        ...cashSale(product, 1, PRICE),
        tenders: [{ type: TenderType.CASH, amount: 5_000 }],
    });
    const refundable = await post(
        seller,
        '/sales',
        cashSale(product, 1, PRICE),
    );
    seed.voided = await post(admin, `/sales/${String(seed.receipt._id)}/void`, {
        reason: 'Mis-rung',
    });
    seed.refunded = await post(
        admin,
        `/sales/${String(refundable._id)}/refund`,
        { reason: 'Returned' },
    );

    // The closer: a discounted sale voided before close, a cash drop, then
    // their own close: every Z-read section has something in it.
    await post(closer, '/shifts', { counts: FLOAT_COUNTS });
    const closerSale = await post(closer, '/sales', {
        ...cashSale(product, 3, 3 * PRICE - 100),
        discount: { type: DiscountType.FIXED, value: 100, reason: 'Dent' },
    });
    await post(closer, '/sales', cashSale(product, 1, PRICE));
    await post(admin, `/sales/${String(closerSale._id)}/void`, {
        reason: 'Mis-rung',
    });
    await post(closer, '/shifts/current/drawer', {
        type: DrawerMovementType.CASH_DROP,
        amount: 10_000,
        reason: 'Safe',
    });
    seed.closedReport = await post(closer, '/shifts/current/close', {
        counts: FLOAT_COUNTS,
    });

    // The absentee: the admin force-closes their shift.
    const absentShift = await openShift(db, absentee);
    seed.forcedReport = await post(admin, `/shifts/${absentShift}/close`, {
        counts: FLOAT_COUNTS,
    });

    // Stock history.
    await post(restocker, '/restocks', {
        description: 'Delivery',
        restockDetails: [{ product, quantity: 3, unitCost: 3_000 }],
    });
    await post(restocker, '/adjustments', {
        description: 'Count',
        adjustDetails: [{ product, change: -1, reason: 'Damaged' }],
    });

    // An account with a real password, to log in with.
    const name = `cashier-${randomUUID().slice(0, 8)}`;
    const password = 'a-long-password';
    await post(admin, '/users', {
        users: [{ name, password, roles: [Role.Seller] }],
    });
    seed.login = await read<Body>(
        await db.call(seller, 'POST', '/auth/login', {
            username: name,
            password,
        }),
    );
});

afterAll(async () => {
    await db?.close();
});

// ---------------------------------------------------------------- shifts

describe('shifts', () => {
    it('POST /shifts and the drawer answer CurrentShiftView, every movement a DrawerMovementView', () => {
        expectShape('POST /shifts', seed.opened, CURRENT_SHIFT_VIEW_SHAPE);
        expectShape(
            'POST /shifts/current/drawer',
            seed.drawer,
            CURRENT_SHIFT_VIEW_SHAPE,
        );
        expectEach(
            'POST /shifts/current/drawer movements',
            seed.drawer.movements,
            DRAWER_MOVEMENT_VIEW_SHAPE,
        );
    });

    it('GET /shifts/current wraps the open shift', async () => {
        const body = await get(seller, '/shifts/current');
        expectShape('GET /shifts/current', body, {
            shift: 'required',
        } as const);
        expectShape('shift', body.shift, CURRENT_SHIFT_VIEW_SHAPE);
        expectEach(
            'shift.movements',
            (body.shift as Body).movements,
            DRAWER_MOVEMENT_VIEW_SHAPE,
        );
    });

    function expectZRead(at: string, report: Body) {
        expectShape(at, report, Z_READ_REPORT_SHAPE);
        expectEach(
            `${at} movements`,
            report.movements,
            DRAWER_MOVEMENT_VIEW_SHAPE,
        );
        const sales = report.sales as Body;
        expectShape(`${at} sales`, sales, Z_READ_SALES_SHAPE);
        for (const key of ['discounts', 'voids', 'refunds']) {
            expectShape(`${at} sales.${key}`, sales[key], COUNTED_AMOUNT_SHAPE);
        }
        // `cash` and `gcash` are plain integers (expectValueKinds).
        expectShape(`${at} tenders`, report.tenders, Z_READ_TENDERS_SHAPE);
        const drawer = report.drawer as Body;
        expectShape(`${at} drawer`, drawer, Z_READ_DRAWER_SHAPE);
        expectShape(
            `${at} drawer.reversalPayouts`,
            drawer.reversalPayouts,
            COUNTED_AMOUNT_SHAPE,
        );
        expectValueKinds(at, report);
    }

    it('the cashier’s own close answers a ZReadReport, section by section', async () => {
        expectZRead('POST /shifts/current/close', seed.closedReport);
        const last = await get(closer, '/shifts/last-closed');
        expectShape('GET /shifts/last-closed', last, {
            report: 'required',
        } as const);
        expectZRead('GET /shifts/last-closed report', last.report as Body);
    });

    it('the admin’s force-close answers a ZReadReport', () => {
        // The absentee's shift has no movements: check the sections only.
        const report = seed.forcedReport;
        expectShape('POST /shifts/:id/close', report, Z_READ_REPORT_SHAPE);
        expect(report.closedByAdmin).toBe(true);
        expectShape('sales', report.sales, Z_READ_SALES_SHAPE);
        expectShape('tenders', report.tenders, Z_READ_TENDERS_SHAPE);
        expectShape('drawer', report.drawer, Z_READ_DRAWER_SHAPE);
    });

    it('GET /shifts and GET /shifts/:id answer ShiftListItem', async () => {
        const rows = await page(
            admin,
            '/shifts?page=1&limit=10',
            SHIFT_LIST_ITEM_SHAPE,
        );
        const closed = rows.filter((row) => row.report !== null);
        expect(closed.length).toBeGreaterThan(0);
        for (const row of closed) {
            expectShape('GET /shifts report', row.report, Z_READ_REPORT_SHAPE);
        }
        const one = await get(admin, `/shifts/${String(rows[0]._id)}`);
        expectShape('GET /shifts/:id', one, SHIFT_LIST_ITEM_SHAPE);
    });
});

// ---------------------------------------------------------------- sales

describe('sales', () => {
    function expectReceipt(at: string, receipt: Body) {
        expectShape(at, receipt, RECEIPT_SHAPE);
        expectEach(`${at} tenders`, receipt.tenders, TENDER_SHAPE);
        expectEach(`${at} items`, receipt.items, RECEIPT_ITEM_SHAPE);
        expectNoInternals(at, receipt);
    }

    it('POST /sales answers a Receipt, every tender and item included', () => {
        expectReceipt('POST /sales (split)', seed.splitReceipt);
        expectShape(
            'POST /sales (split) discount',
            seed.splitReceipt.discount,
            RECEIPT_DISCOUNT_SHAPE,
        );
        expectReceipt('POST /sales (cash)', seed.receipt);
        expect(seed.receipt.discount).toBeNull();
    });

    it.each([
        ['void', () => seed.voided],
        ['refund', () => seed.refunded],
    ])(
        'POST /sales/:id/%s answers SaleView, with the cashier as an id and no internals',
        (label, sale) => {
            const at = `POST /sales/:id/${label}`;
            expectShape(at, sale(), SALE_VIEW_SHAPE);
            expectEach(`${at} tenders`, sale().tenders, TENDER_SHAPE);
            expectShape(
                `${at} reversal`,
                sale().reversal,
                SALE_REVERSAL_VIEW_SHAPE,
            );
            expectId(`${at} cashier`, sale().cashier);
            expectNoInternals(at, sale());
        },
    );

    it.each([
        ['an admin', () => admin],
        ['the cashier', () => seller],
    ])(
        'GET /sales answers SaleRow to %s, reversed rows and all',
        async (_label, who) => {
            const rows = await page(
                who(),
                '/sales?page=1&limit=100',
                SALE_ROW_SHAPE,
            );
            for (const [i, row] of rows.entries()) {
                const at = `GET /sales data[${i}]`;
                expectRef(`${at} cashier`, row.cashier);
                expectEach(`${at} tenders`, row.tenders, TENDER_SHAPE);
                if (row.discount !== undefined) {
                    expectShape(
                        `${at} discount`,
                        row.discount,
                        SALE_DISCOUNT_VIEW_SHAPE,
                    );
                }
                if (row.reversal !== undefined) {
                    expectShape(
                        `${at} reversal`,
                        row.reversal,
                        SALE_REVERSAL_VIEW_SHAPE,
                    );
                }
                expectNoInternals(at, row);
            }
            // The void and the refund are in the list, with their reversal.
            expect(
                rows.filter((row) => row.reversal).length,
            ).toBeGreaterThanOrEqual(2);
        },
    );

    it('GET /sales/details/:id answers SaleLine, the product by name', async () => {
        const body = await send(
            seller,
            'GET',
            `/sales/details/${String(seed.splitReceipt._id)}`,
            undefined,
            200,
        );
        for (const line of expectEach(
            'GET /sales/details',
            body,
            SALE_LINE_SHAPE,
        )) {
            expectShape(
                'GET /sales/details product',
                line.product,
                PRODUCT_REF_SHAPE,
            );
            expectId('GET /sales/details sales', line.sales);
        }
    });
});

// ---------------------------------------------------------------- stock

describe('products, stock and history', () => {
    it('GET /products, /products/:EAN and /products/matches', async () => {
        const rows = await page(
            restocker,
            '/products?page=1&limit=10',
            PRODUCT_VIEW_SHAPE,
        );
        expectShape(
            'GET /products/:EAN',
            await get(seller, `/products/${String(rows[0].EAN)}`),
            PRODUCT_VIEW_SHAPE,
        );
        expectEach(
            'GET /products/matches',
            await send(
                seller,
                'GET',
                '/products/matches?name=item',
                undefined,
                200,
            ),
            PRODUCT_MATCH_SHAPE,
        );
    });

    it('GET /inventories answers InventoryRow with its product', async () => {
        const rows = await page(
            restocker,
            '/inventories?page=1&limit=10',
            INVENTORY_ROW_SHAPE,
        );
        for (const row of rows) {
            expectShape(
                'GET /inventories product',
                row.product,
                PRODUCT_VIEW_SHAPE,
            );
            expectId('GET /inventories updatedBy', row.updatedBy);
        }
    });

    it('restock rows, lines and the user filter', async () => {
        const rows = await page(
            restocker,
            '/restocks?page=1&limit=10',
            RESTOCK_ROW_SHAPE,
        );
        for (const row of rows) expectRef('restockedBy', row.restockedBy);
        const lines = await page(
            restocker,
            `/restocks/details/${String(rows[0]._id)}?page=1&limit=10`,
            RESTOCK_LINE_SHAPE,
        );
        for (const line of lines) {
            expectShape(
                'restock line product',
                line.product,
                PRODUCT_VIEW_SHAPE,
            );
        }
        expectEach(
            'GET /restocks/users',
            await send(restocker, 'GET', '/restocks/users', undefined, 200),
            USER_REF_SHAPE,
        );
    });

    it('adjustment rows, lines and the user filter', async () => {
        const rows = await page(
            restocker,
            '/adjustments?page=1&limit=10',
            ADJUSTMENT_ROW_SHAPE,
        );
        for (const row of rows) expectRef('adjustedBy', row.adjustedBy);
        const lines = await page(
            restocker,
            `/adjustments/details/${String(rows[0]._id)}?page=1&limit=10`,
            ADJUSTMENT_LINE_SHAPE,
        );
        for (const line of lines) {
            expectShape(
                'adjustment line product',
                line.product,
                PRODUCT_VIEW_SHAPE,
            );
        }
        expectEach(
            'GET /adjustments/users',
            await send(restocker, 'GET', '/adjustments/users', undefined, 200),
            USER_REF_SHAPE,
        );
    });
});

// ---------------------------------------------------------------- dashboard

describe('dashboard', () => {
    it('matches DashboardView for an ADMIN, money included', async () => {
        const body = await get(admin, '/dashboard');
        expectShape('GET /dashboard (admin)', body, DASHBOARD_VIEW_SHAPE);
        for (const key of DASHBOARD_MONEY_KEYS) {
            expect({ key, sent: key in body }).toEqual({ key, sent: true });
        }
        for (const restock of expectEach(
            'recentRestocks',
            body.recentRestocks,
            RESTOCK_ACTIVITY_SHAPE,
        )) {
            expect(restock).toHaveProperty('totalCost');
            expectRef('recentRestocks restockedBy', restock.restockedBy);
        }
        for (const sale of expectEach(
            'recentSales',
            body.recentSales,
            SALE_ROW_SHAPE,
        )) {
            expectRef('recentSales cashier', sale.cashier);
            expectEach('recentSales tenders', sale.tenders, TENDER_SHAPE);
            expectNoInternals('recentSales', sale);
        }
        for (const adjustment of expectEach(
            'recentAdjustments',
            body.recentAdjustments,
            ADJUSTMENT_ROW_SHAPE,
        )) {
            expectRef('recentAdjustments adjustedBy', adjustment.adjustedBy);
        }
    });

    it('matches DashboardView for anyone else, with no money key at all', async () => {
        const body = await get(restocker, '/dashboard');
        expectShape('GET /dashboard (restocker)', body, DASHBOARD_VIEW_SHAPE);
        for (const key of DASHBOARD_MONEY_KEYS) {
            expect({ key, sent: key in body }).toEqual({ key, sent: false });
        }
        for (const restock of expectEach(
            'recentRestocks',
            body.recentRestocks,
            RESTOCK_ACTIVITY_SHAPE,
        )) {
            expect(restock).not.toHaveProperty('totalCost');
            expectRef('recentRestocks restockedBy', restock.restockedBy);
        }
        for (const adjustment of expectEach(
            'recentAdjustments',
            body.recentAdjustments,
            ADJUSTMENT_ROW_SHAPE,
        )) {
            expectRef('recentAdjustments adjustedBy', adjustment.adjustedBy);
        }
    });
});

// ---------------------------------------------------------------- users

describe('users and auth', () => {
    it('GET /users answers UserView', async () => {
        await page(admin, '/users?page=1&limit=10', USER_VIEW_SHAPE);
    });

    it('GET /users/profile answers ProfileView', async () => {
        expectShape(
            'GET /users/profile',
            await get(seller, '/users/profile'),
            PROFILE_VIEW_SHAPE,
        );
    });

    it('POST /auth/login answers LoginResponse', () => {
        expect(seed.login.status).toBe(201);
        expectShape('POST /auth/login', seed.login.body, LOGIN_RESPONSE_SHAPE);
        expectShape(
            'POST /auth/login user',
            seed.login.body.user,
            LOGIN_USER_SHAPE,
        );
    });
});

// ---------------------------------------------------------------- errors

describe('errors', () => {
    it.each([
        [
            '404',
            () =>
                db.call(
                    admin,
                    'GET',
                    `/sales/details/${new Types.ObjectId().toString()}`,
                ),
            404,
            ErrorCode.NOT_FOUND,
        ],
        [
            '400',
            () => db.call(admin, 'GET', '/sales?page=0&limit=5'),
            400,
            ErrorCode.VALIDATION_INVALID_INPUT,
        ],
        [
            // The closer's shift is closed: selling now is SHIFT_NOT_OPEN.
            '409',
            () =>
                db.call(
                    closer,
                    'POST',
                    '/sales',
                    cashSale(seed.product, 1, PRICE),
                ),
            409,
            ErrorCode.SHIFT_NOT_OPEN,
        ],
    ])(
        'a %s matches AppErrorResponse, with its ErrorCode',
        async (label, call, status, code) => {
            const res = await read<Body>(await call());
            expect(res.status).toBe(status);
            expectShape(label, res.body, APP_ERROR_RESPONSE_SHAPE);
            expectValueKinds(label, res.body);
            expect(res.body.error).toBe(code);
        },
    );
});
