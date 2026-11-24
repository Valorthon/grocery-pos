import { Model, Types } from 'mongoose';
import { User } from '../user/user.schema';
import { FakeUserModel } from '../user/testing/fake-user-model';
import { FakeRefreshTokenModel } from './refresh-token/testing/fake-refresh-token-model';
import { RefreshToken } from './refresh-token/refresh-token.schema';
import { SessionLivenessService } from './session-liveness.service';
import { Role } from './types';

describe('SessionLivenessService (#480)', () => {
    let users: FakeUserModel;
    let tokens: FakeRefreshTokenModel;
    let service: SessionLivenessService;

    beforeEach(() => {
        users = new FakeUserModel();
        tokens = new FakeRefreshTokenModel();
        service = new SessionLivenessService(
            users as unknown as Model<User>,
            tokens as unknown as Model<RefreshToken>,
        );
    });

    const payload = (userId: string, sid?: string) => ({
        userId,
        username: 'cashier',
        roles: [Role.Seller],
        ...(sid ? { sid } : {}),
    });

    it('is live for an active user with a live session', async () => {
        const row = users.seed({ name: 'cashier' });
        const sid = new Types.ObjectId();
        tokens.seed(row._id, { family: sid });
        await expect(
            service.isLive(payload(row._id.toString(), sid.toString())),
        ).resolves.toBe(true);
    });

    it('is not live once the user is deactivated', async () => {
        const row = users.seed({ name: 'cashier', isActive: false });
        const sid = new Types.ObjectId();
        tokens.seed(row._id, { family: sid });
        await expect(
            service.isLive(payload(row._id.toString(), sid.toString())),
        ).resolves.toBe(false);
    });

    it('is not live for an unknown user or a bad id', async () => {
        await expect(
            service.isLive(payload(new Types.ObjectId().toString())),
        ).resolves.toBe(false);
        await expect(service.isLive(payload('nope'))).resolves.toBe(false);
    });

    it('is not live once the session has no refresh token', async () => {
        const row = users.seed({ name: 'cashier' });
        await expect(
            service.isLive(
                payload(row._id.toString(), new Types.ObjectId().toString()),
            ),
        ).resolves.toBe(false);
        await expect(
            service.isLive(payload(row._id.toString(), 'bad-sid')),
        ).resolves.toBe(false);
    });

    it('checks only the active flag for a legacy token without sid', async () => {
        const row = users.seed({ name: 'cashier' });
        await expect(service.isLive(payload(row._id.toString()))).resolves.toBe(
            true,
        );
    });
});
