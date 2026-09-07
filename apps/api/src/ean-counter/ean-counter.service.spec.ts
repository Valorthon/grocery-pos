import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EanCounterService } from './ean-counter.service';
import { EANCounter } from './ean-counter.schema';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { ValidationError } from '../common/errors';

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
        it('produces a 13-digit EAN that passes its own validation', async () => {
            findByIdAndUpdate.mockReturnValue({
                lean: () => Promise.resolve({ prefix: 200, counter: 1 }),
            });

            const ean = await service.generate();

            expect(ean).toHaveLength(13);
            expect(ean).toMatch(/^\d{13}$/);
            // generate() and ensureValid() must agree, or every generated
            // barcode would be rejected at scan time.
            expect(() => service.ensureValid(ean)).not.toThrow();
        });

        it('stays self-consistent across a range of counter values', async () => {
            for (const counter of [0, 7, 42, 999, 123456789]) {
                findByIdAndUpdate.mockReturnValue({
                    lean: () => Promise.resolve({ prefix: 200, counter }),
                });

                const ean = await service.generate();
                expect(() => service.ensureValid(ean)).not.toThrow();
            }
        });
    });

    describe('ensureValid', () => {
        it.each([
            ['too short', '12345'],
            ['non-numeric', 'abcdefghijklm'],
            ['14 digits', '01234567890123'],
            ['empty', ''],
        ])('rejects a %s EAN', (_label, ean) => {
            expect(() => service.ensureValid(ean)).toThrow(ValidationError);
        });

        it('rejects a 13-digit EAN with a bad checksum', () => {
            // Known-good EAN-13 with its final check digit deliberately altered.
            expect(() => service.ensureValid('4006381333931')).not.toThrow();
            expect(() => service.ensureValid('4006381333932')).toThrow(
                ValidationError,
            );
        });
    });
});
