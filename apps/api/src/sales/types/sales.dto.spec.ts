import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ReverseSaleDto, SellDto } from './sales.dto';
import { DiscountType, PaymentType, TenderType } from './sales.types';
import { STRING_LIMITS } from '../../constants';

const SELL_DETAILS = [{ product: '507f1f77bcf86cd799439011', quantity: 1 }];
const CASH_TENDER = [{ type: TenderType.CASH, amount: 10000 }];

async function validateDiscount(discount: unknown) {
    const dto = plainToInstance(SellDto, {
        paymentType: PaymentType.CASH,
        tenders: CASH_TENDER,
        sellDetails: SELL_DETAILS,
        discount,
    });
    const errors = await validate(dto);
    return errors.find((e) => e.property === 'discount');
}

async function discountErrors(discount: unknown) {
    return (await validateDiscount(discount))?.children ?? [];
}

function constraintsOf(errors: ValidationError[], property: string) {
    return errors.find((e) => e.property === property)?.constraints;
}

describe('SellDto.discount', () => {
    it('is optional', async () => {
        expect(await discountErrors(undefined)).toHaveLength(0);
    });

    it('accepts a whole percent and a fixed centavo amount', async () => {
        expect(
            await discountErrors({
                type: DiscountType.PERCENT,
                value: 20,
                reason: 'loyalty',
            }),
        ).toHaveLength(0);
        expect(
            await discountErrors({
                type: DiscountType.FIXED,
                value: 150000,
                reason: 'price match',
            }),
        ).toHaveLength(0);
    });

    it('rejects an unknown type', async () => {
        const errors = await discountErrors({
            type: 'SENIOR',
            value: 20,
            reason: 'x',
        });

        expect(constraintsOf(errors, 'type')).toHaveProperty('isEnum');
    });

    it('rejects a fractional value', async () => {
        const errors = await discountErrors({
            type: DiscountType.PERCENT,
            value: 12.5,
            reason: 'x',
        });

        expect(constraintsOf(errors, 'value')).toHaveProperty('isInt');
    });

    it('rejects a zero value and a percent above 100', async () => {
        expect(
            constraintsOf(
                await discountErrors({
                    type: DiscountType.FIXED,
                    value: 0,
                    reason: 'x',
                }),
                'value',
            ),
        ).toHaveProperty('min');
        expect(
            constraintsOf(
                await discountErrors({
                    type: DiscountType.PERCENT,
                    value: 101,
                    reason: 'x',
                }),
                'value',
            ),
        ).toHaveProperty('isPercentInRange');
    });

    it('allows a fixed amount above 100 centavos', async () => {
        const errors = await discountErrors({
            type: DiscountType.FIXED,
            value: 101,
            reason: 'x',
        });

        expect(errors).toHaveLength(0);
    });

    it('requires a non-blank reason', async () => {
        const missing = await discountErrors({
            type: DiscountType.PERCENT,
            value: 10,
        });
        const blank = await discountErrors({
            type: DiscountType.PERCENT,
            value: 10,
            reason: '   ',
        });

        expect(constraintsOf(missing, 'reason')).toHaveProperty('isNotEmpty');
        expect(constraintsOf(blank, 'reason')).toHaveProperty('isNotEmpty');
    });

    it('caps the reason length', async () => {
        const errors = await discountErrors({
            type: DiscountType.PERCENT,
            value: 10,
            reason: 'x'.repeat(STRING_LIMITS.REASON + 1),
        });

        expect(constraintsOf(errors, 'reason')).toHaveProperty('maxLength');
    });

    it.each([
        ['an empty array', []],
        [
            'an array of discounts',
            [{ type: DiscountType.PERCENT, value: 10, reason: 'x' }],
        ],
        ['an empty object', {}],
    ])('rejects %s', async (_, discount) => {
        const error = await validateDiscount(discount);

        expect(error).toBeDefined();
    });
});

describe('SellDto through the global ValidationPipe', () => {
    // The options main.ts registers globally.
    const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
    });

    function run(body: unknown) {
        return pipe.transform(body, { type: 'body', metatype: SellDto });
    }

    const discount = { type: DiscountType.PERCENT, value: 20, reason: 'x' };

    it('accepts a well-formed discounted sale', async () => {
        await expect(
            run({
                paymentType: PaymentType.CASH,
                tenders: CASH_TENDER,
                sellDetails: SELL_DETAILS,
                discount,
            }),
        ).resolves.toBeInstanceOf(SellDto);
    });

    it.each([
        [
            'a client-sent discount amount',
            { discount: { ...discount, amount: 1 } },
        ],
        ['a client-sent total', { discount, totalAmount: 1 }],
        ['a client-sent subtotal', { discount, subtotal: 1 }],
    ])('rejects %s', async (_, extra) => {
        await expect(
            run({
                paymentType: PaymentType.CASH,
                tenders: CASH_TENDER,
                sellDetails: SELL_DETAILS,
                ...extra,
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});

describe('SellDto payment', () => {
    const REF = '1234567890123';
    const GCASH_TENDER = [{ type: TenderType.GCASH, amount: 10000 }];

    async function errorsFor(body: Record<string, unknown>) {
        const dto = plainToInstance(SellDto, {
            sellDetails: SELL_DETAILS,
            ...body,
        });
        return { dto, errors: await validate(dto) };
    }

    function propertyErrors(errors: ValidationError[], property: string) {
        return errors.find((e) => e.property === property)?.constraints;
    }

    it('accepts SPLIT as a payment type', async () => {
        const { errors } = await errorsFor({
            paymentType: PaymentType.SPLIT,
            referenceNumber: REF,
            tenders: [...CASH_TENDER, ...GCASH_TENDER],
        });

        expect(errors).toHaveLength(0);
    });

    it.each([PaymentType.GCASH, PaymentType.SPLIT])(
        'requires a reference number for %s',
        async (paymentType) => {
            const { errors } = await errorsFor({
                paymentType,
                tenders: GCASH_TENDER,
            });

            expect(propertyErrors(errors, 'referenceNumber')).toHaveProperty(
                'isNotEmpty',
            );
        },
    );

    it.each([
        ['too short', '123456789012'],
        ['too long', '12345678901234'],
        ['not digits', '12345678901ab'],
        ['a placeholder', 'x'],
    ])('rejects a reference that is %s', async (_, referenceNumber) => {
        const { errors } = await errorsFor({
            paymentType: PaymentType.GCASH,
            referenceNumber,
            tenders: GCASH_TENDER,
        });

        expect(propertyErrors(errors, 'referenceNumber')).toBeDefined();
    });

    it('strips the spaces GCash prints between digit groups', async () => {
        const { dto, errors } = await errorsFor({
            paymentType: PaymentType.GCASH,
            referenceNumber: '1234 567 890123',
            tenders: GCASH_TENDER,
        });

        expect(errors).toHaveLength(0);
        expect(dto.referenceNumber).toBe(REF);
    });

    it('rejects a reference number on a cash sale', async () => {
        const { errors } = await errorsFor({
            paymentType: PaymentType.CASH,
            referenceNumber: REF,
            tenders: CASH_TENDER,
        });

        expect(propertyErrors(errors, 'referenceNumber')).toHaveProperty(
            'isNotOnCashSale',
        );
    });

    it('requires at least one tender', async () => {
        const missing = await errorsFor({ paymentType: PaymentType.CASH });
        const empty = await errorsFor({
            paymentType: PaymentType.CASH,
            tenders: [],
        });

        expect(propertyErrors(missing.errors, 'tenders')).toBeDefined();
        expect(propertyErrors(empty.errors, 'tenders')).toHaveProperty(
            'arrayNotEmpty',
        );
    });

    it.each([
        ['a zero amount', { type: TenderType.CASH, amount: 0 }],
        ['a fractional amount', { type: TenderType.CASH, amount: 10.5 }],
        ['an unknown type', { type: 'CARD', amount: 100 }],
    ])('rejects a tender with %s', async (_, tender) => {
        const { errors } = await errorsFor({
            paymentType: PaymentType.CASH,
            tenders: [tender],
        });

        expect(errors.find((e) => e.property === 'tenders')).toBeDefined();
    });
});

describe('ReverseSaleDto', () => {
    it('requires a non-blank reason', async () => {
        const blank = await validate(
            plainToInstance(ReverseSaleDto, { reason: '   ' }),
        );
        const ok = await validate(
            plainToInstance(ReverseSaleDto, { reason: 'mis-ring' }),
        );

        expect(blank[0]?.constraints).toHaveProperty('isNotEmpty');
        expect(ok).toHaveLength(0);
    });

    it('caps the reason length', async () => {
        const errors = await validate(
            plainToInstance(ReverseSaleDto, {
                reason: 'x'.repeat(STRING_LIMITS.REASON + 1),
            }),
        );

        expect(errors[0]?.constraints).toHaveProperty('maxLength');
    });
});
