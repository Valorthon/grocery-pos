import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EanCounterService } from './ean-counter.service';
import { EANCounter } from './ean-counter.schema';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { InternalError } from '../common/errors';
import { hasValidCheckDigit, isReservedBarcode } from '@grocery-pos/contracts';

const CONFIG: Record<string, unknown> = {
    EAN_COUNTER_ID: 'EAN_COUNTER_ID',
    EAN_COUNTER_DIGITS: 9,
};

describe('EanCounterService', () => {
    let service: EanCounterService;
    let findByIdAndUpdate: jest.Mock;

    beforeEach(async () => {
        findByIdAndUpdate = jest.fn();

        const moduleRef = await Test.createTestingModule({
            providers: [
                EanCounterService,
                {
                    provide: getModelToken(EANCounter.name),
                    useValue: { findByIdAndUpdate },
                },
                {
                    provide: TypedConfigService,
                    useValue: { get: (key: string) => CONFIG[key] },
                },
            ],
        }).compile();

        service = moduleRef.get(EanCounterService);
    });

    describe('generate', () => {
        it('produces a 13-digit EAN-13 with a valid check digit', async () => {
            findByIdAndUpdate.mockReturnValue({
                lean: () => Promise.resolve({ prefix: 200, counter: 1 }),
            });

            const ean = await service.generate();

            expect(ean).toBe('2000000000015');
            // Generated codes must scan as valid barcodes, and sit in the
            // reserved range that typed barcodes may not take (issue #14).
            expect(hasValidCheckDigit(ean)).toBe(true);
            expect(isReservedBarcode(ean)).toBe(true);
        });

        it('stays valid and reserved across a range of counter values', async () => {
            for (const counter of [0, 7, 42, 999, 123456789, 999999999]) {
                findByIdAndUpdate.mockReturnValue({
                    lean: () => Promise.resolve({ prefix: 200, counter }),
                });

                const ean = await service.generate();
                expect(ean).toMatch(/^200\d{10}$/);
                expect(hasValidCheckDigit(ean)).toBe(true);
                expect(isReservedBarcode(ean)).toBe(true);
            }
        });

        it('refuses to hand out a code once the counter overflows its digits', async () => {
            findByIdAndUpdate.mockReturnValue({
                lean: () =>
                    Promise.resolve({ prefix: 200, counter: 1_000_000_000 }),
            });

            await expect(service.generate()).rejects.toBeInstanceOf(
                InternalError,
            );
        });
    });
});
