import type { ClientSession, Model } from 'mongoose';
import { SettingsService, settingsView } from './settings.service';
import { Settings } from './settings.schema';
import type { TypedConfigService } from '../common/typed-config/typed-config.service';

const row = {
    key: 'store',
    storeName: 'Shop',
    branchName: '',
    address: '',
    contactNumber: '',
    tin: '',
    receiptFooter: '',
    timezone: 'Europe/London',
    currency: 'PHP',
    defaultReorderLevel: 10,
    version: 2,
    contextLock: 8,
};
function harness() {
    const lean = jest.fn().mockResolvedValue(row);
    const session = jest.fn().mockReturnValue({ lean });
    const model = {
        init: jest.fn().mockResolvedValue(undefined),
        updateOne: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockReturnValue({ session }),
        findOneAndUpdate: jest.fn().mockReturnValue({ lean }),
    };
    const config = { get: jest.fn().mockReturnValue('Europe/London') };
    return {
        service: new SettingsService(
            model as unknown as Model<Settings>,
            config as unknown as TypedConfigService,
        ),
        model,
        lean,
        session,
    };
}
describe('persistent settings', () => {
    it('initializes unique indexes before atomic defaults and preserves deployment timezone', async () => {
        const { service, model } = harness();
        await service.onModuleInit();
        expect(model.init.mock.invocationCallOrder[0]).toBeLessThan(
            model.updateOne.mock.invocationCallOrder[0]!,
        );
        expect(model.updateOne).toHaveBeenCalledWith(
            { key: 'store' },
            {
                $setOnInsert: expect.objectContaining({
                    timezone: 'Europe/London',
                    currency: 'PHP',
                    version: 0,
                }),
            },
            { upsert: true, runValidators: true },
        );
    });
    it('tolerates a concurrent initializer duplicate only', async () => {
        const { service, model } = harness();
        model.updateOne.mockRejectedValueOnce({ code: 11000 });
        await expect(service.onModuleInit()).resolves.toBeUndefined();
        model.updateOne.mockRejectedValueOnce(new Error('offline'));
        await expect(service.onModuleInit()).rejects.toThrow('offline');
    });
    it('fails startup if index initialization fails', async () => {
        const { service, model } = harness();
        model.init.mockRejectedValueOnce(new Error('index'));
        await expect(service.onModuleInit()).rejects.toThrow('index');
        expect(model.updateOne).not.toHaveBeenCalled();
    });
    it('reads every time and never exposes private row fields', async () => {
        const { service, model, lean, session } = harness();
        expect(await service.read()).toEqual(settingsView(row));
        expect(session).toHaveBeenCalledWith(null);
        lean.mockResolvedValueOnce({ ...row, timezone: 'UTC' });
        expect(await service.timezone()).toBe('UTC');
        expect(model.findOne).toHaveBeenCalledTimes(2);
        expect(await service.read()).not.toHaveProperty('contextLock');
        lean.mockResolvedValueOnce(null);
        await expect(service.read()).rejects.toThrow('not initialized');
    });
    it('reads a legacy row without an expiry alert window as 7 days (#213)', async () => {
        const { service, lean } = harness();
        expect((await service.read()).expiryAlertDays).toBe(7);
        lean.mockResolvedValueOnce({ ...row, expiryAlertDays: 30 });
        expect((await service.read()).expiryAlertDays).toBe(30);
    });
    it('initializes new stores with the default expiry alert window', async () => {
        const { service, model } = harness();
        await service.onModuleInit();
        expect(model.updateOne).toHaveBeenCalledWith(
            { key: 'store' },
            {
                $setOnInsert: expect.objectContaining({ expiryAlertDays: 7 }),
            },
            expect.anything(),
        );
    });
    it('serializes context establishment on the singleton inside the transaction', async () => {
        const { service, model, lean } = harness();
        const session = {} as ClientSession;
        expect(await service.lockContext(session)).toEqual(settingsView(row));
        expect(model.findOneAndUpdate).toHaveBeenCalledWith(
            { key: 'store' },
            { $inc: { contextLock: 1 } },
            { new: true, session },
        );
        lean.mockResolvedValueOnce(null);
        await expect(service.lockContext(session)).rejects.toThrow(
            'not initialized',
        );
    });
    it('compares versions and validates replacement in the same transaction', async () => {
        const { service, model, lean } = harness();
        const session = {} as ClientSession;
        await expect(
            service.replace(2, { storeName: 'Next' }, session),
        ).resolves.toEqual(settingsView(row));
        expect(model.findOneAndUpdate).toHaveBeenCalledWith(
            { key: 'store', version: 2 },
            { $set: { storeName: 'Next' }, $inc: { version: 1 } },
            { new: true, session, runValidators: true },
        );
        lean.mockResolvedValueOnce(null);
        await expect(service.replace(2, {}, session)).rejects.toThrow('Reload');
    });
});
it.each([null, 0, 'unavailable', {}, { code: 12345 }])(
    'does not suppress an initializer failure %j',
    async (failure) => {
        const { service, model } = harness();
        model.updateOne.mockRejectedValueOnce(failure);
        await expect(service.onModuleInit()).rejects.toEqual(failure);
    },
);
it('binds reads and timezone lookups to the supplied transaction snapshot', async () => {
    const { service, session } = harness();
    const transaction = {} as ClientSession;
    await service.read(transaction);
    await service.timezone(transaction);
    expect(session).toHaveBeenCalledWith(transaction);
});
describe('store today (#215)', () => {
    it('is the calendar date in the committed store timezone, not UTC', async () => {
        const { service, lean } = harness();
        lean.mockResolvedValue({ ...row, timezone: 'Asia/Manila' });
        // 16:30 UTC on the 31st is 00:30 on Nov 1 in Manila.
        await expect(
            service.today(new Date('2026-10-31T16:30:00Z')),
        ).resolves.toEqual({ today: '2026-11-01', timezone: 'Asia/Manila' });
        lean.mockResolvedValue({ ...row, timezone: 'America/New_York' });
        await expect(
            service.today(new Date('2026-01-01T03:00:00Z')),
        ).resolves.toEqual({
            today: '2025-12-31',
            timezone: 'America/New_York',
        });
    });
});
