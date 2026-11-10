/**
 * GET /settings/today (#215): every role reads the store-calendar date for
 * date presets, over real HTTP with the real guards and filter.
 */
import { getModelToken } from '@nestjs/mongoose';
import {
    AccessHarness,
    ALL_ROLES,
    bootAccessHarness,
    caller,
} from '../common/testing/access-harness';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SettingsAdminService } from './settings-admin.service';
import { Settings } from './settings.schema';

describe('GET /settings/today access by role (e2e)', () => {
    let harness: AccessHarness;
    beforeAll(async () => {
        const row = { key: 'store', timezone: 'Asia/Manila', version: 0 };
        harness = await bootAccessHarness(
            [SettingsController],
            [
                SettingsService,
                { provide: SettingsAdminService, useValue: {} },
                {
                    provide: getModelToken(Settings.name),
                    useValue: {
                        init: () => Promise.resolve(),
                        updateOne: () => Promise.resolve({}),
                        findOne: () => ({
                            session: () => ({
                                lean: () => Promise.resolve(row),
                            }),
                        }),
                    },
                },
            ],
        );
    });
    afterAll(async () => {
        await harness.close();
    });

    it.each(ALL_ROLES)('as %s -> 200 with the store date', async (role) => {
        const res = await harness.call(caller(role), 'GET', '/settings/today');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(['timezone', 'today']);
        expect(body.timezone).toBe('Asia/Manila');
        expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('refuses a caller with no roles', async () => {
        const res = await harness.call(caller(), 'GET', '/settings/today');
        expect(res.status).toBe(403);
    });

    it('is 401 without a session', async () => {
        const res = await fetch(
            `${await harness.app.getUrl()}/v1/settings/today`,
        );
        expect(res.status).toBe(401);
    });
});
