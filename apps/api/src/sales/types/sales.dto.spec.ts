import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { SellDto } from './sales.dto';
import { DiscountType, PaymentType } from './sales.types';
import { STRING_LIMITS } from '../../constants';

async function discountErrors(discount: unknown) {
    const dto = plainToInstance(SellDto, {
        paymentType: PaymentType.CASH,
        sellDetails: [{ product: '507f1f77bcf86cd799439011', quantity: 1 }],
        discount,
    });
    const errors = await validate(dto);
    const [discountError] = errors.filter((e) => e.property === 'discount');
    return discountError?.children ?? [];
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
});
