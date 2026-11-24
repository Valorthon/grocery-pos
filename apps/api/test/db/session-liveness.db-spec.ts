/**
 * A deactivated user's session ends at once (#480), against the real app
 * with the production SessionLivenessService (`realSessions`): the next
 * request with a still-unexpired access token is 401, and a sale from it
 * is refused and writes nothing. The open shift stays for an ADMIN.
 */
import { Types } from 'mongoose';
import { ErrorCode, Role } from '@grocery-pos/contracts';
import {
    bootDbApp,
    caller,
    cashSale,
    grantStepUp,
    openShift,
    read,
    seedProduct,
    stockOf,
    type Caller,
    type DbApp,
} from './db-app';

let db: DbApp;
const admin = caller('live-admin', Role.Admin);

beforeAll(async () => {
    db = await bootDbApp({ realSessions: true });
    await Promise.all(
        ['User', 'StepUp', 'RefreshToken', 'Sales', 'Shift'].map((name) =>
            db.model(name).init(),
        ),
    );
    await addUser(admin);
});
afterAll(async () => {
    await db?.close();
});

/** A stored active user with a live session for `call`'s default sid. */
async function addUser(who: Caller): Promise<void> {
    await db.model('User').create({
        _id: new Types.ObjectId(who.userId),
        name: who.username,
        roles: who.roles,
        isActive: true,
        passwordHash: 'unused',
    });
    await db.model('RefreshToken').create({
        user: new Types.ObjectId(who.userId),
        family: new Types.ObjectId(who.userId),
        expiry: new Date(Date.now() + 3_600_000),
    });
}

it('refuses an unknown user and a session without a refresh token', async () => {
    const ghost = caller('live-ghost', Role.Seller);
    expect((await db.call(ghost, 'GET', '/users/profile')).status).toBe(401);

    const seller = caller('live-revoked', Role.Seller);
    await addUser(seller);
    expect((await db.call(seller, 'GET', '/users/profile')).status).toBe(200);
    await db
        .model('RefreshToken')
        .deleteMany({ user: new Types.ObjectId(seller.userId) });
    const res = await read(await db.call(seller, 'GET', '/users/profile'));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe(ErrorCode.AUTH_INVALID_TOKEN);
});

it("ends a deactivated cashier's session at once: no sale is recorded, the shift stays open", async () => {
    const seller = caller('live-seller', Role.Seller);
    await addUser(seller);
    const shift = await openShift(db, seller);
    const product = await seedProduct(db, 5000, 10);

    await grantStepUp(db, admin);
    const patched = await db.call(admin, 'PATCH', '/users', {
        updates: [{ user: seller.userId, update: { isActive: false } }],
    });
    expect(patched.status).toBe(200);

    const profile = await read(await db.call(seller, 'GET', '/users/profile'));
    expect(profile.status).toBe(401);
    expect(profile.body.error).toBe(ErrorCode.AUTH_INVALID_TOKEN);

    const sale = await read(
        await db.call(seller, 'POST', '/sales', cashSale(product, 1, 5000)),
    );
    expect(sale.status).toBe(401);
    expect(sale.body.error).toBe(ErrorCode.AUTH_INVALID_TOKEN);
    expect(
        await db
            .model('Sales')
            .countDocuments({ cashier: new Types.ObjectId(seller.userId) }),
    ).toBe(0);
    expect(await stockOf(db, product)).toBe(10);

    const open = await db
        .model<{ status: string }>('Shift')
        .findById(shift)
        .lean();
    expect(open?.status).toBe('OPEN');
});
