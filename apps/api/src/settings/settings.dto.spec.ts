import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SETTINGS_LIMITS } from '@grocery-pos/contracts';
import { UpdateSettingsDto, validTimezone } from './settings.dto';

describe('store settings boundaries', () => {
    it('trims identity and preserves literal presentation text', () => {
        const dto = plainToInstance(UpdateSettingsDto, {
            version: 0,
            storeName: "  M&M's  ",
            receiptFooter: '  Thank you <3  ',
            address: '  Manila  ',
        });
        expect(validateSync(dto)).toEqual([]);
        expect(dto.storeName).toBe("M&M's");
        expect(dto.receiptFooter).toBe('Thank you <3');
        expect(dto.address).toBe('Manila');
    });
    it.each([
        {},
        { version: 0 },
        { version: -1, storeName: 'Shop' },
        { version: 0.5, storeName: 'Shop' },
        { version: '0', storeName: 'Shop' },
        { version: 0, storeName: '' },
        { version: 0, storeName: '   ' },
        { version: 0, storeName: null },
        { version: 0, address: null },
        { version: 0, timezone: 'Asia/Atlantis' },
        { version: 0, timezone: null },
        { version: 0, timezone: 'GMT+8' },
        { version: 0, defaultReorderLevel: null },
        { version: 0, defaultReorderLevel: 0.5 },
        { version: 0, defaultReorderLevel: SETTINGS_LIMITS.REORDER_LEVEL + 1 },
        { version: 0, receiptFooter: 'x'.repeat(SETTINGS_LIMITS.FOOTER + 1) },
    ])('rejects invalid patches %j', (body) => {
        expect(
            validateSync(plainToInstance(UpdateSettingsDto, body)).length,
        ).toBeGreaterThan(0);
    });
    it('accepts explicit zero default and identity clearing', () => {
        expect(
            validateSync(
                plainToInstance(UpdateSettingsDto, {
                    version: 0,
                    defaultReorderLevel: 0,
                    branchName: '',
                }),
            ),
        ).toEqual([]);
    });
    it.each(['Asia/Manila', 'America/New_York', 'UTC'])(
        'accepts IANA %s',
        (zone) => expect(validTimezone(zone)).toBe(true),
    );
});
