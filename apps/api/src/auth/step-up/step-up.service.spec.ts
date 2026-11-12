import { Types, type ClientSession, type Model } from 'mongoose';
import { StepUpService } from './step-up.service';
import { StepUpSchema, type StepUp } from './step-up.schema';
import { FakeStepUpModel } from './testing/fake-step-up-model';
import { FakeRefreshTokenModel } from '../refresh-token/testing/fake-refresh-token-model';
import type { RefreshToken } from '../refresh-token/refresh-token.schema';
import { ErrorCode } from '../../common/errors';
import { Role } from '../types';

describe('StepUpService (#310)', () => {
    const session = {} as ClientSession;
    let stepUps: FakeStepUpModel;
    let tokens: FakeRefreshTokenModel;
    let service: StepUpService;
    const userId = new Types.ObjectId();
    const sid = new Types.ObjectId();
    const actor = {
        userId: userId.toString(),
        username: 'admin',
        roles: [Role.Admin],
        sid: sid.toString(),
    };

    beforeEach(() => {
        jest.useFakeTimers({ now: new Date('2026-11-12T08:00:00Z') });
        stepUps = new FakeStepUpModel();
        tokens = new FakeRefreshTokenModel();
        tokens.seed(userId, {
            family: sid,
            expiry: new Date('2026-11-13T08:00:00Z'),
        });
        service = new StepUpService(
            stepUps as unknown as Model<StepUp>,
            tokens as unknown as Model<RefreshToken>,
        );
    });
    afterEach(() => jest.useRealTimers());

    it('lasts five minutes from the re-auth, then is refused', async () => {
        const expiresAt = await service.grant(actor.userId, actor.sid);
        expect(expiresAt.toISOString()).toBe('2026-11-12T08:05:00.000Z');

        jest.setSystemTime(new Date('2026-11-12T08:04:59Z'));
        await expect(
            service.assertLive(actor, session),
        ).resolves.toBeUndefined();

        jest.setSystemTime(new Date('2026-11-12T08:05:00Z'));
        await expect(service.assertLive(actor, session)).rejects.toMatchObject({
            code: ErrorCode.USER_REAUTH_REQUIRED,
            statusCode: 403,
        });
    });

    it('a guarded action does not extend it; a new re-auth starts a new window', async () => {
        await service.grant(actor.userId, actor.sid);
        jest.setSystemTime(new Date('2026-11-12T08:04:00Z'));
        await service.assertLive(actor, session);
        expect(stepUps.rows[0].expiresAt.toISOString()).toBe(
            '2026-11-12T08:05:00.000Z',
        );
        await service.grant(actor.userId, actor.sid);
        expect(stepUps.rows).toHaveLength(1);
        expect(stepUps.rows[0].expiresAt.toISOString()).toBe(
            '2026-11-12T08:09:00.000Z',
        );
    });

    it('needs the session to still exist', async () => {
        await service.grant(actor.userId, actor.sid);
        tokens.rows.clear();
        await expect(service.assertLive(actor, session)).rejects.toMatchObject({
            code: ErrorCode.USER_REAUTH_REQUIRED,
        });
        expect(await service.sessionExists(actor.userId, actor.sid)).toBe(
            false,
        );
    });

    it('refuses a token without sid', async () => {
        await expect(
            service.assertLive({ ...actor, sid: undefined }, session),
        ).rejects.toMatchObject({ code: ErrorCode.USER_REAUTH_REQUIRED });
    });

    it('has a TTL index on expiresAt and one row per user and session', () => {
        expect(StepUpSchema.indexes()).toEqual(
            expect.arrayContaining([
                [
                    { expiresAt: 1 },
                    expect.objectContaining({ expireAfterSeconds: 0 }),
                ],
                [
                    { user: 1, sid: 1 },
                    expect.objectContaining({ unique: true }),
                ],
            ]),
        );
    });
});
