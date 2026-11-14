import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
    AuditAction,
    DrawerMovementType,
    ErrorCode,
    Role,
} from '@grocery-pos/contracts';
import { AuditService } from '../../src/audit/audit.service';
import {
    bootDbApp,
    caller,
    type DbApp,
    FLOAT_COUNTS,
    openShift,
    read,
} from './db-app';

let db: DbApp;
beforeAll(async () => {
    db = await bootDbApp();
});
afterAll(async () => {
    await db?.close();
});

async function setup(type = DrawerMovementType.CASH_DROP) {
    const seller = caller(`drawer-${randomUUID().slice(0, 8)}`, Role.Seller);
    const shiftId = await openShift(db, seller);
    const body = {
        shiftId,
        idempotencyKey: randomUUID(),
        type,
        amount: 100_000,
        reason: 'physical cash moved once',
    };
    const send = (request = body) =>
        db.call(seller, 'POST', '/shifts/current/drawer', request).then(read);
    return { seller, body, send };
}

async function auditCount(shiftId: string) {
    return db.model('AuditLog').countDocuments({
        targetId: new Types.ObjectId(shiftId),
        action: {
            $in: [AuditAction.SHIFT_CASH_IN, AuditAction.SHIFT_CASH_DROPPED],
        },
    });
}

it.each([DrawerMovementType.CASH_IN, DrawerMovementType.CASH_DROP])(
    'a lost %s answer can be retried without another movement or audit',
    async (type) => {
        const { body, send } = await setup(type);
        const first = await send(); // The caller loses this response after commit.
        expect(first.status).toBe(201);
        const retry = await send();
        expect(retry).toEqual(first);
        expect(retry.body.movements).toHaveLength(1);
        expect(await auditCount(body.shiftId)).toBe(1);
        expect(JSON.stringify(retry.body)).not.toMatch(
            /idempotencyKey|requestHash/,
        );
    },
);

it('concurrent retries commit one physical movement and one audit', async () => {
    const { body, send } = await setup();
    const results = await Promise.all(Array.from({ length: 8 }, () => send()));
    for (const result of results) {
        expect(result.status).toBe(201);
        expect(result.body.movements).toHaveLength(1);
    }
    expect(await auditCount(body.shiftId)).toBe(1);
});

it.each(['amount', 'reason', 'type'] as const)(
    'refuses the same key with changed %s',
    async (field) => {
        const { body, send } = await setup();
        expect((await send()).status).toBe(201);
        const changed = {
            ...body,
            [field]:
                field === 'amount'
                    ? 101
                    : field === 'reason'
                      ? 'other'
                      : DrawerMovementType.CASH_IN,
        };
        const retry = await send(changed);
        expect(retry.status).toBe(409);
        expect(retry.body.error).toBe(
            ErrorCode.SHIFT_DRAWER_IDEMPOTENCY_MISMATCH,
        );
        expect(await auditCount(body.shiftId)).toBe(1);
    },
);

it('replays after close without charging a later shift or exposing closing finances', async () => {
    const { seller, body, send } = await setup();
    expect((await send()).status).toBe(201);
    expect(
        (
            await db.call(seller, 'POST', '/shifts/current/close', {
                counts: FLOAT_COUNTS,
            })
        ).status,
    ).toBe(201);
    const next = await openShift(db, seller);
    const retry = await send();
    expect(retry.status).toBe(201);
    expect(retry.body._id).toBe(body.shiftId);
    expect(retry.body.status).toBe('CLOSED');
    expect(JSON.stringify(retry.body)).not.toMatch(
        /expectedCash|overShort|zRead|countedCash/,
    );
    const current = await read(await db.call(seller, 'GET', '/shifts/current'));
    expect(current.body.shift?._id).toBe(next);
    expect(current.body.shift?.movements).toEqual([]);
    const lateNew = await send({ ...body, idempotencyKey: randomUUID() });
    expect(lateNew.status).toBe(409);
    expect(lateNew.body.error).toBe(ErrorCode.SHIFT_NOT_OPEN);
});

it('cannot write or replay another cashier drawer', async () => {
    const { body, send } = await setup();
    expect((await send()).status).toBe(201);
    const other = caller('other-cashier', Role.Seller);
    await openShift(db, other);
    const response = await read(
        await db.call(other, 'POST', '/shifts/current/drawer', body),
    );
    expect(response.status).toBe(409);
    expect(response.body.error).toBe(ErrorCode.SHIFT_NOT_OPEN);
});

it('rolls back movement and retry evidence if the actual audit insert fails, then accepts the same key once', async () => {
    const { body, send } = await setup();
    const audit = db.app.get(AuditService);
    const record = audit.record.bind(audit);
    const spy = jest
        .spyOn(audit, 'record')
        .mockImplementationOnce(async (...args) => {
            await record(...args);
            throw new Error('audit failed after insert');
        });
    const failed = await send();
    spy.mockRestore();
    expect(failed.status).toBe(500);
    expect(await auditCount(body.shiftId)).toBe(0);
    const row = await db
        .model<{ movements: unknown[] }>('Shift')
        .findById(body.shiftId)
        .lean();
    expect(row?.movements).toEqual([]);
    expect((await send()).body.movements).toHaveLength(1);
    expect(await auditCount(body.shiftId)).toBe(1);
});
