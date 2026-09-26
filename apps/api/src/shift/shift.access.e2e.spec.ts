/**
 * Who may do what with shifts, over real HTTP (issue #2). The real
 * ShiftController and ShiftService run behind the real guards, filter and
 * ValidationPipe; the Shift and Sales models are in-memory fakes.
 */
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import {
    DrawerMovementType,
    ErrorCode,
    ShiftStatus,
    type CurrentShiftView,
    type ZReadReport,
} from '@grocery-pos/contracts';
import { Role } from '../auth/types';
import {
    AccessHarness,
    ALL_ROLES,
    bootAccessHarness,
    caller,
    Caller,
} from '../common/testing/access-harness';
import { Sales } from '../sales/sales.schema';
import { ShiftController } from './shift.controller';
import { Shift } from './shift.schema';
import { ShiftService } from './shift.service';
import {
    FakeModel,
    fakeConnection,
    fakeShiftModel,
} from './testing/fake-shift-model';

const FLOAT_COUNTS = { '1000': 1 };

const shifts = fakeShiftModel();
const sales = new FakeModel();

describe('Shift routes (e2e)', () => {
    let harness: AccessHarness;

    beforeAll(async () => {
        harness = await bootAccessHarness(
            [ShiftController],
            [
                ShiftService,
                {
                    provide: getConnectionToken(),
                    useValue: fakeConnection(shifts, sales),
                },
                { provide: getModelToken(Shift.name), useValue: shifts },
                { provide: getModelToken(Sales.name), useValue: sales },
            ],
        );
    });

    beforeEach(() => {
        shifts.rows = [];
        sales.rows = [];
    });

    afterAll(async () => {
        await harness.close();
    });

    async function open(who: Caller): Promise<CurrentShiftView> {
        const res = await harness.call(who, 'POST', '/shifts', {
            counts: FLOAT_COUNTS,
        });
        expect(res.status).toBe(201);
        return (await res.json()) as CurrentShiftView;
    }

    describe('role matrix', () => {
        const someId = new Types.ObjectId().toString();
        const cashierRoutes: Array<
            [method: 'GET' | 'POST', path: string, body?: unknown]
        > = [
            ['POST', '/shifts', { counts: FLOAT_COUNTS }],
            ['GET', '/shifts/current'],
            [
                'POST',
                '/shifts/current/drawer',
                { type: DrawerMovementType.CASH_IN, amount: 100, reason: 'x' },
            ],
            ['POST', '/shifts/current/close', { counts: FLOAT_COUNTS }],
            ['GET', '/shifts/last-closed'],
        ];
        const adminRoutes: Array<
            [method: 'GET' | 'POST', path: string, body?: unknown]
        > = [
            ['GET', '/shifts?page=1&limit=10'],
            ['GET', `/shifts/${someId}`],
            ['POST', `/shifts/${someId}/close`, { counts: FLOAT_COUNTS }],
        ];

        it.each(
            ALL_ROLES.flatMap((role) =>
                cashierRoutes.map(
                    ([method, path, body]) =>
                        [
                            role,
                            method,
                            path,
                            body,
                            // ADMIN alone is refused: it needs SELLER too (#84).
                            role === Role.Seller,
                        ] as const,
                ),
            ),
        )(
            '%s %s %s -> allowed: %s',
            async (role, method, path, body, allowed) => {
                const res = await harness.call(
                    caller(role),
                    method,
                    path,
                    body,
                );
                if (allowed) expect(res.status).not.toBe(403);
                else expect(res.status).toBe(403);
            },
        );

        it.each(
            ALL_ROLES.flatMap((role) =>
                adminRoutes.map(
                    ([method, path, body]) =>
                        [
                            role,
                            method,
                            path,
                            body,
                            role === Role.Admin,
                        ] as const,
                ),
            ),
        )(
            '%s %s %s -> allowed: %s',
            async (role, method, path, body, allowed) => {
                const res = await harness.call(
                    caller(role),
                    method,
                    path,
                    body,
                );
                if (allowed) expect(res.status).not.toBe(403);
                else expect(res.status).toBe(403);
            },
        );

        it('lets a seller who also manages users use the cashier routes, not the admin ones', async () => {
            const who = caller(Role.Seller, Role.UserManager);

            expect(
                (await harness.call(who, 'GET', '/shifts/current')).status,
            ).toBe(200);
            expect(
                (await harness.call(who, 'GET', '/shifts?page=1&limit=10'))
                    .status,
            ).toBe(403);
        });
    });

    describe('a cashier reaches only their own shift', () => {
        it('never sees another cashier’s open shift as theirs', async () => {
            const [a, b] = [caller(Role.Seller), caller(Role.Seller)];
            await open(b);

            const res = await harness.call(a, 'GET', '/shifts/current');

            expect(await res.json()).toEqual({ shift: null });
        });

        it('cannot read or close another cashier’s shift by id', async () => {
            const [a, b] = [caller(Role.Seller), caller(Role.Seller)];
            const shift = await open(b);

            const read = await harness.call(a, 'GET', `/shifts/${shift._id}`);
            const close = await harness.call(
                a,
                'POST',
                `/shifts/${shift._id}/close`,
                { counts: FLOAT_COUNTS },
            );

            expect(read.status).toBe(403);
            expect(close.status).toBe(403);
            expect(shifts.byId(shift._id)!.status).toBe(ShiftStatus.OPEN);
        });

        it('cannot close another cashier’s shift through its own close route', async () => {
            const [a, b] = [caller(Role.Seller), caller(Role.Seller)];
            const shift = await open(b);

            const res = await harness.call(a, 'POST', '/shifts/current/close', {
                counts: FLOAT_COUNTS,
            });

            expect(res.status).toBe(409);
            expect(((await res.json()) as { error: string }).error).toBe(
                ErrorCode.SHIFT_NOT_OPEN,
            );
            expect(shifts.byId(shift._id)!.status).toBe(ShiftStatus.OPEN);
        });

        it('does not hand one cashier another’s last Z-read', async () => {
            const [a, b] = [caller(Role.Seller), caller(Role.Seller)];
            await open(b);
            await harness.call(b, 'POST', '/shifts/current/close', {
                counts: FLOAT_COUNTS,
            });

            const res = await harness.call(a, 'GET', '/shifts/last-closed');

            expect(await res.json()).toEqual({ report: null });
        });
    });

    describe('cashier flow', () => {
        it('opens, stays blind while open, and gets the full Z-read on close', async () => {
            const who = caller(Role.Seller);
            await open(who);
            await harness.call(who, 'POST', '/shifts/current/drawer', {
                type: DrawerMovementType.CASH_DROP,
                amount: 30_000,
                reason: 'to safe',
            });

            const current = await harness.call(who, 'GET', '/shifts/current');
            const body = JSON.stringify(await current.json());
            expect(body).not.toMatch(/expected|overShort|variance|gross/i);

            const close = await harness.call(
                who,
                'POST',
                '/shifts/current/close',
                { counts: { '500': 1, '200': 1 } },
            );
            expect(close.status).toBe(201);
            const report = (await close.json()) as ZReadReport;
            expect(report.drawer).toMatchObject({
                openingFloat: 100_000,
                cashDrops: 30_000,
                expectedCash: 70_000,
                countedCash: 70_000,
                overShort: 0,
            });

            const last = await harness.call(who, 'GET', '/shifts/last-closed');
            expect(await last.json()).toEqual({ report });
        });

        it('refuses a second open shift with 409', async () => {
            const who = caller(Role.Seller);
            await open(who);

            const res = await harness.call(who, 'POST', '/shifts', {
                counts: FLOAT_COUNTS,
            });

            expect(res.status).toBe(409);
            expect(((await res.json()) as { error: string }).error).toBe(
                ErrorCode.SHIFT_ALREADY_OPEN,
            );
        });

        it.each([
            ['an unknown denomination', { counts: { '5000': 1 } }],
            ['the old dotted coin key', { counts: { 'coin-0.25': 4 } }],
            ['a negative count', { counts: { '1000': -1 } }],
            ['a fractional count', { counts: { '1000': 1.5 } }],
            ['counts as an array', { counts: [1] }],
            ['a zero float', { counts: { '1000': 0 } }],
            ['a client-sent total', { counts: FLOAT_COUNTS, openingFloat: 1 }],
        ])('refuses opening with %s', async (_, body) => {
            const res = await harness.call(
                caller(Role.Seller),
                'POST',
                '/shifts',
                body,
            );

            expect(res.status).toBe(400);
            expect(shifts.rows).toHaveLength(0);
        });

        it.each([
            [
                'a payout type',
                {
                    type: DrawerMovementType.REVERSAL_PAYOUT,
                    amount: 100,
                    reason: 'x',
                },
            ],
            [
                'a zero amount',
                { type: DrawerMovementType.CASH_IN, amount: 0, reason: 'x' },
            ],
            [
                'a blank reason',
                { type: DrawerMovementType.CASH_IN, amount: 100, reason: ' ' },
            ],
            ['no reason', { type: DrawerMovementType.CASH_IN, amount: 100 }],
            [
                'no amount',
                { type: DrawerMovementType.CASH_DROP, reason: 'safe' },
            ],
            [
                'a fractional amount',
                { type: DrawerMovementType.CASH_IN, amount: 1.5, reason: 'x' },
            ],
        ])('refuses a drawer movement with %s', async (_, body) => {
            const who = caller(Role.Seller);
            await open(who);

            const res = await harness.call(
                who,
                'POST',
                '/shifts/current/drawer',
                body,
            );

            expect(res.status).toBe(400);
        });
    });

    describe('admin', () => {
        it('lists every shift and force-closes an abandoned one, recorded as by an admin', async () => {
            const cashier = caller(Role.Seller);
            const admin = caller(Role.Admin);
            const shift = await open(cashier);

            const list = await harness.call(
                admin,
                'GET',
                '/shifts?page=1&limit=10&status=OPEN',
            );
            expect(await list.json()).toMatchObject({
                totalItems: 1,
                data: [{ _id: shift._id, status: ShiftStatus.OPEN }],
            });

            const close = await harness.call(
                admin,
                'POST',
                `/shifts/${shift._id}/close`,
                { counts: FLOAT_COUNTS },
            );
            expect(close.status).toBe(201);
            expect(await close.json()).toMatchObject({
                closedByAdmin: true,
                drawer: { expectedCash: 100_000, overShort: 0 },
            });

            const again = await harness.call(
                admin,
                'POST',
                `/shifts/${shift._id}/close`,
                { counts: FLOAT_COUNTS },
            );
            expect(again.status).toBe(409);

            const detail = await harness.call(
                admin,
                'GET',
                `/shifts/${shift._id}`,
            );
            expect(await detail.json()).toMatchObject({
                status: ShiftStatus.CLOSED,
                report: { closedByAdmin: true },
            });
        });

        it('refuses an ADMIN-only account every cashier route, writing nothing (#84)', async () => {
            const admin = caller(Role.Admin);

            const opened = await harness.call(admin, 'POST', '/shifts', {
                counts: FLOAT_COUNTS,
            });
            const drawer = await harness.call(
                admin,
                'POST',
                '/shifts/current/drawer',
                { type: DrawerMovementType.CASH_IN, amount: 100, reason: 'x' },
            );
            const close = await harness.call(
                admin,
                'POST',
                '/shifts/current/close',
                { counts: FLOAT_COUNTS },
            );
            const current = await harness.call(admin, 'GET', '/shifts/current');
            const last = await harness.call(
                admin,
                'GET',
                '/shifts/last-closed',
            );

            for (const res of [opened, drawer, close, current, last]) {
                expect(res.status).toBe(403);
            }
            expect(shifts.rows).toHaveLength(0);
        });

        it('opens a shift of its own to sell when it also holds SELLER, like any cashier', async () => {
            const admin = caller(Role.Admin, Role.Seller);

            await open(admin);

            const res = await harness.call(admin, 'GET', '/shifts/current');
            expect(
                ((await res.json()) as { shift: CurrentShiftView | null })
                    .shift,
            ).not.toBeNull();
        });

        it('force-closes as ADMIN alone, and so does an admin who also sells', async () => {
            for (const admin of [
                caller(Role.Admin),
                caller(Role.Admin, Role.Seller),
            ]) {
                const shift = await open(caller(Role.Seller));
                const close = await harness.call(
                    admin,
                    'POST',
                    `/shifts/${shift._id}/close`,
                    { counts: FLOAT_COUNTS },
                );
                expect(close.status).toBe(201);
                expect(shifts.byId(shift._id)!.status).toBe(ShiftStatus.CLOSED);
            }
        });

        it('rejects a malformed shift id with 400', async () => {
            const res = await harness.call(
                caller(Role.Admin),
                'GET',
                '/shifts/not-an-id',
            );

            expect(res.status).toBe(400);
        });
    });
});
