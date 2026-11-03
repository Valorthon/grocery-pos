/** Explicit manager-approved setup for existing transactional/wire fixtures. */
import * as argon from 'argon2';
import { Types } from 'mongoose';
import {
    OverrideAction,
    quantityAmount,
    type UnitOfMeasure,
    Role,
    type OverrideContextRequest,
    type SaleRequest,
} from '@grocery-pos/contracts';
import { ManagerOverrideService } from '../../src/auth/override/override.service';
import type { DbApp, Caller } from './db-app';

const initialized = new WeakMap<DbApp, Promise<void>>();
export const FIXTURE_MANAGER = 'fixture-approval-admin';
export async function ensureApprovalFixtures(db: DbApp, requester: Caller) {
    let ready = initialized.get(db);
    if (!ready) {
        ready = (async () => {
            await db.model('User').create({
                name: FIXTURE_MANAGER,
                roles: [Role.Admin],
                isActive: true,
                passwordHash: 'not-a-login-hash',
                overridePinHash: await argon.hash('012345'),
                overridePinVersion: 'fixture-v1',
            });
        })();
        initialized.set(db, ready);
    }
    await ready;
    await db.model('User').updateOne(
        { _id: new Types.ObjectId(requester.userId) },
        {
            $setOnInsert: {
                name: requester.username,
                roles: requester.roles,
                isActive: true,
                passwordHash: 'not-a-login-hash',
            },
        },
        { upsert: true },
    );
}

export async function approvalHeaders(
    db: DbApp,
    requester: Caller,
    action: OverrideAction,
    context: OverrideContextRequest,
) {
    await ensureApprovalFixtures(db, requester);
    // Existing suites test DB races rather than credential HTTP throttling.
    // Use the real approval service/argon2/context resolution; the new
    // override suite separately exercises HTTP authentication and limits.
    const result = await db.app.get(ManagerOverrideService).issue(
        { ...requester, sid: requester.sid ?? requester.userId },
        {
            username: FIXTURE_MANAGER,
            pin: '012345',
            action,
            context,
        },
    );
    return { 'X-Manager-Approval': result.token };
}

export async function discountApprovalHeaders(
    db: DbApp,
    requester: Caller,
    sale: SaleRequest,
) {
    const products = await db
        .model<{ price: number; unit?: UnitOfMeasure }>('Product')
        .find({ _id: { $in: sale.sellDetails.map((l) => l.product) } })
        .lean();
    const prices = new Map(products.map((p) => [String(p._id), p]));
    const subtotal = sale.sellDetails.reduce(
        (sum, l) =>
            sum +
            quantityAmount(
                prices.get(l.product)!.price,
                l.quantity,
                prices.get(l.product)!.unit,
            ),
        0,
    );
    return approvalHeaders(db, requester, OverrideAction.DISCOUNT, {
        sale,
        expectedSubtotal: subtotal,
    });
}
