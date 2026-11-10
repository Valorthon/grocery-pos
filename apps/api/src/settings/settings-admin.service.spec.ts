import type { Connection, Model } from 'mongoose';
import { AuditAction, Role, type AuthUser } from '@grocery-pos/contracts';
import { SettingsAdminService } from './settings-admin.service';
import type { SettingsService } from './settings.service';
import type { Shift } from '../shift/shift.schema';
import type { OfflineLease } from '../offline/offline-lease.schema';
import type { AuditService } from '../audit/audit.service';
const before = {
    storeName: 'Shop',
    branchName: '',
    address: '',
    contactNumber: '',
    tin: '',
    receiptFooter: '',
    timezone: 'Asia/Manila',
    currency: 'PHP',
    defaultReorderLevel: 10,
    expiryAlertDays: 7,
    version: 0,
};
const actor: AuthUser = {
    userId: '507f1f77bcf86cd799439011',
    username: 'admin',
    roles: [Role.Admin],
};
function setup() {
    const session: { withTransaction: jest.Mock; endSession: jest.Mock } = {
        withTransaction: jest.fn(
            async (
                fn: (session: object) => Promise<unknown>,
            ): Promise<unknown> => fn(session),
        ),
        endSession: jest.fn().mockResolvedValue(undefined),
    };
    const connection = { startSession: jest.fn().mockResolvedValue(session) };
    const settings = {
        lockContext: jest.fn().mockResolvedValue(before),
        replace: jest.fn().mockResolvedValue({ ...before, version: 1 }),
    };
    const shiftSession = jest.fn().mockResolvedValue(null),
        leaseSession = jest.fn().mockResolvedValue(null);
    const shifts = {
            exists: jest.fn().mockReturnValue({ session: shiftSession }),
        },
        leases = {
            exists: jest.fn().mockReturnValue({ session: leaseSession }),
        };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SettingsAdminService(
        connection as unknown as Connection,
        settings as unknown as SettingsService,
        shifts as unknown as Model<Shift>,
        leases as unknown as Model<OfflineLease>,
        audit as unknown as AuditService,
    );
    return {
        service,
        settings,
        shifts,
        leases,
        shiftSession,
        leaseSession,
        audit,
        session,
    };
}
it('updates allowed identity and audits before/after using the same transaction', async () => {
    const { service, settings, audit, session, shifts } = setup();
    await service.update(actor, { version: 0, storeName: 'Next' });
    expect(settings.replace).toHaveBeenCalledWith(
        0,
        { storeName: 'Next' },
        session,
    );
    expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
            actor,
            action: AuditAction.SETTINGS_UPDATED,
            before,
            after: { ...before, version: 1 },
        }),
        session,
    );
    expect(shifts.exists).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
});
it('rejects stale edits before any state or audit write', async () => {
    const { service, settings, audit } = setup();
    await expect(
        service.update(actor, { version: 1, storeName: 'Stale' }),
    ).rejects.toThrow('Reload');
    expect(settings.replace).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
});
it.each(['shift', 'lease'])(
    'refuses timezone changes with an active %s',
    async (kind) => {
        const { service, settings, shiftSession, leaseSession } = setup();
        (kind === 'shift' ? shiftSession : leaseSession).mockResolvedValueOnce({
            _id: 'active',
        });
        await expect(
            service.update(actor, { version: 0, timezone: 'UTC' }),
        ).rejects.toThrow('Close open shifts');
        expect(settings.replace).not.toHaveBeenCalled();
    },
);
it('allows a timezone edit only after both context guards are checked', async () => {
    const { service, shifts, leases } = setup();
    await expect(
        service.update(actor, { version: 0, timezone: 'UTC' }),
    ).resolves.toMatchObject({ version: 1 });
    expect(shifts.exists).toHaveBeenCalled();
    expect(leases.exists).toHaveBeenCalled();
});
it('keeps same-zone edits available while the store is trading', async () => {
    const { service, shifts } = setup();
    await service.update(actor, {
        version: 0,
        timezone: 'Asia/Manila',
        branchName: 'Front',
    });
    expect(shifts.exists).not.toHaveBeenCalled();
});
it('propagates audit failure through transaction rollback', async () => {
    const { service, audit, session } = setup();
    audit.record.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
        service.update(actor, { version: 0, storeName: 'Next' }),
    ).rejects.toThrow('Transaction failed');
    expect(session.endSession).toHaveBeenCalled();
});
it('saves the expiry alert window with its audit entry in one transaction (#213)', async () => {
    const { service, settings, audit, session, shifts } = setup();
    settings.replace.mockResolvedValueOnce({
        ...before,
        expiryAlertDays: 14,
        version: 1,
    });
    await service.update(actor, { version: 0, expiryAlertDays: 14 });
    expect(settings.replace).toHaveBeenCalledWith(
        0,
        { expiryAlertDays: 14 },
        session,
    );
    expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
            before: expect.objectContaining({ expiryAlertDays: 7 }),
            after: expect.objectContaining({ expiryAlertDays: 14 }),
        }),
        session,
    );
    expect(shifts.exists).not.toHaveBeenCalled();
});
