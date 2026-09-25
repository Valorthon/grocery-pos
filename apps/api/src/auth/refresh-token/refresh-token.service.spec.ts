import { Types } from 'mongoose';
import { RefreshTokenService } from './refresh-token.service';
import { RefreshTokenSchema } from './refresh-token.schema';
import {
    FakeRefreshTokenModel,
    TokenOwner,
} from './testing/fake-refresh-token-model';
import { Role } from '../types';
import { AppError, ErrorCode } from '../../common/errors';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import { Model } from 'mongoose';
import { RefreshToken } from './refresh-token.schema';

const config = {
    get: (key: string) => (key === 'REFRESH_EXPIRY_S' ? 86_400 : undefined),
} as unknown as TypedConfigService;

async function rejection(promise: Promise<unknown>) {
    try {
        await promise;
    } catch (err) {
        return err as AppError;
    }
    throw new Error('expected a rejection');
}

describe('RefreshTokenService', () => {
    let model: FakeRefreshTokenModel;
    let service: RefreshTokenService;
    let cashier: TokenOwner;

    beforeEach(() => {
        model = new FakeRefreshTokenModel();
        service = new RefreshTokenService(
            model as unknown as Model<RefreshToken>,
            config,
        );
        cashier = model.addUser({
            _id: new Types.ObjectId(),
            name: 'cashier',
            roles: [Role.Seller],
            isActive: true,
        });
    });

    describe('create', () => {
        it('starts a new session (family) per login', async () => {
            const a = await service.create(cashier._id.toString());
            const b = await service.create(cashier._id.toString());

            expect(a.sid).not.toBe(b.sid);
            expect(model.rows.get(a.refreshId)?.family?.toString()).toBe(a.sid);
        });
    });

    describe('rotate', () => {
        it('replaces the token, keeping its expiry and session', async () => {
            const family = new Types.ObjectId();
            const expiry = new Date(Date.now() + 60_000);
            const oldId = model.seed(cashier, { expiry, family });

            const { refreshId, jwtPayload } = await service.rotate(oldId);

            expect(model.rows.has(oldId)).toBe(false);
            expect(model.rows.get(refreshId)).toMatchObject({
                expiry,
                family,
            });
            expect(jwtPayload).toEqual({
                userId: cashier._id.toString(),
                username: 'cashier',
                roles: [Role.Seller],
                sid: family.toString(),
            });
        });

        it('gives a token from before session ids a session', async () => {
            const oldId = model.seed(cashier, { family: null });

            const { refreshId, jwtPayload } = await service.rotate(oldId);

            expect(jwtPayload.sid).toBeDefined();
            expect(model.rows.get(refreshId)?.family?.toString()).toBe(
                jwtPayload.sid,
            );
        });

        it('refuses a deactivated user with 401 and ends all their sessions', async () => {
            const oldId = model.seed(cashier);
            model.seed(cashier);
            cashier.isActive = false;

            const err = await rejection(service.rotate(oldId));

            expect(err.statusCode).toBe(401);
            expect(err.code).toBe(ErrorCode.AUTH_INVALID_TOKEN);
            expect(model.tokensOf(cashier)).toEqual([]);
            expect(model.create).not.toHaveBeenCalled();
        });

        it('refuses a deleted user with 401, not a TypeError 500', async () => {
            const ghost = new Types.ObjectId();
            const oldId = model.seed(ghost);

            const err = await rejection(service.rotate(oldId));

            expect(err).toBeInstanceOf(AppError);
            expect(err.statusCode).toBe(401);
            expect(err.code).toBe(ErrorCode.AUTH_INVALID_TOKEN);
            expect(model.rows.has(oldId)).toBe(false);
        });

        it('refuses an expired token with 401 AUTH_TOKEN_EXPIRED', async () => {
            const oldId = model.seed(cashier, {
                expiry: new Date(Date.now() - 1000),
            });

            const err = await rejection(service.rotate(oldId));

            expect(err.code).toBe(ErrorCode.AUTH_TOKEN_EXPIRED);
            expect(model.rows.has(oldId)).toBe(false);
        });

        it('still answers 401 when cleaning up after a refusal fails', async () => {
            const oldId = model.seed(new Types.ObjectId());
            model.failNext = 'deleteOne';

            const err = await rejection(service.rotate(oldId));

            expect(err.statusCode).toBe(401);
        });

        it('keeps the old token when creating the new one fails', async () => {
            const oldId = model.seed(cashier);
            model.failNext = 'create';

            await expect(service.rotate(oldId)).rejects.toThrow(
                'MongoNetworkError',
            );

            expect(model.rows.has(oldId)).toBe(true);
            // The cookie the client still holds works on the next try.
            await expect(service.rotate(oldId)).resolves.toBeDefined();
        });

        it('keeps the old token and withdraws the new one when the delete fails', async () => {
            const oldId = model.seed(cashier);
            model.failNext = 'deleteOne';

            await expect(service.rotate(oldId)).rejects.toThrow(
                'MongoNetworkError',
            );

            expect(
                model.tokensOf(cashier).map((t) => t._id.toString()),
            ).toEqual([oldId]);
        });

        it('lets only one of two concurrent rotations of a token win', async () => {
            const oldId = model.seed(cashier);

            const results = await Promise.allSettled([
                service.rotate(oldId),
                service.rotate(oldId),
            ]);

            expect(results.map((r) => r.status).sort()).toEqual([
                'fulfilled',
                'rejected',
            ]);
            const loser = results.find((r) => r.status === 'rejected');
            expect((loser as PromiseRejectedResult).reason).toMatchObject({
                statusCode: 401,
            });
            // Only the winner's new token is left.
            expect(model.tokensOf(cashier)).toHaveLength(1);
        });
    });

    describe('revoking', () => {
        it('revokeAllForUser ends every session of that user only', async () => {
            const other = model.addUser({
                _id: new Types.ObjectId(),
                name: 'other',
                roles: [Role.Seller],
                isActive: true,
            });
            model.seed(cashier);
            model.seed(cashier);
            model.seed(other);

            await service.revokeAllForUser(cashier._id.toString());

            expect(model.tokensOf(cashier)).toEqual([]);
            expect(model.tokensOf(other)).toHaveLength(1);
        });

        it('revokeAllForUser can keep the caller’s own session', async () => {
            const mine = new Types.ObjectId();
            const keep = model.seed(cashier, { family: mine });
            model.seed(cashier);
            model.seed(cashier, { family: null });

            await service.revokeAllForUser(cashier._id.toString(), {
                keepSid: mine.toString(),
            });

            expect(
                model.tokensOf(cashier).map((t) => t._id.toString()),
            ).toEqual([keep]);
        });

        it('revokeAllForUsers ends the sessions of each user', async () => {
            const ids = [new Types.ObjectId(), new Types.ObjectId()];
            ids.forEach((id) => model.seed(id));
            model.seed(cashier);

            await service.revokeAllForUsers(ids.map(String));

            expect(ids.flatMap((id) => model.tokensOf(id))).toEqual([]);
            expect(model.tokensOf(cashier)).toHaveLength(1);
        });

        it('revokeAllForUsers with no ids touches nothing', async () => {
            await service.revokeAllForUsers([]);

            expect(model.deleteMany).not.toHaveBeenCalled();
        });
    });
});

describe('RefreshToken schema', () => {
    it('has a TTL index on expiry, so expired sessions are deleted', () => {
        expect(RefreshTokenSchema.indexes()).toContainEqual([
            { expiry: 1 },
            expect.objectContaining({ expireAfterSeconds: 0 }),
        ]);
    });
});
