import { SettingsController } from './settings.controller';
import type { SettingsService } from './settings.service';
import type { SettingsAdminService } from './settings-admin.service';
import type { AuthUser } from '@grocery-pos/contracts';
it('returns only the settings service view and forwards the authenticated update actor', async () => {
    const data = { storeName: 'Shop' };
    const settings = { read: jest.fn().mockResolvedValue(data) };
    const admin = { update: jest.fn().mockResolvedValue(data) };
    const controller = new SettingsController(
        settings as unknown as SettingsService,
        admin as unknown as SettingsAdminService,
    );
    expect(await controller.get()).toBe(data);
    const actor: AuthUser = { userId: 'actor', username: 'admin', roles: [] };
    const dto = { version: 0, storeName: 'Shop' };
    expect(await controller.update(actor, dto)).toBe(data);
    expect(admin.update).toHaveBeenCalledWith(actor, dto);
});
it('answers the store today from the settings service (#215)', async () => {
    const data = { today: '2026-11-10', timezone: 'Asia/Manila' };
    const settings = { today: jest.fn().mockResolvedValue(data) };
    const controller = new SettingsController(
        settings as unknown as SettingsService,
        {} as unknown as SettingsAdminService,
    );
    expect(await controller.today()).toBe(data);
});
