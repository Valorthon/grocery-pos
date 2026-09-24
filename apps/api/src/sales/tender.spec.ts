import { settleTenders } from './tender';
import { PaymentType, TenderType } from './types/sales.types';
import { ValidationError } from '../common/errors';

const cash = (amount: number) => ({ type: TenderType.CASH, amount });
const gcash = (amount: number) => ({ type: TenderType.GCASH, amount });

describe('settleTenders', () => {
    it('gives change from cash over the total', () => {
        expect(settleTenders(PaymentType.CASH, [cash(100000)], 80050)).toEqual({
            tenders: [cash(100000)],
            amountTendered: 100000,
            changeGiven: 19950,
        });
    });

    it('accepts exact cash with no change', () => {
        expect(
            settleTenders(PaymentType.CASH, [cash(80050)], 80050).changeGiven,
        ).toBe(0);
    });

    it('accepts GCash for exactly the total', () => {
        expect(
            settleTenders(PaymentType.GCASH, [gcash(80050)], 80050),
        ).toMatchObject({ amountTendered: 80050, changeGiven: 0 });
    });

    it('splits ₱500 cash + ₱500 GCash on a ₱1,000 sale', () => {
        expect(
            settleTenders(
                PaymentType.SPLIT,
                [cash(50000), gcash(50000)],
                100000,
            ),
        ).toEqual({
            tenders: [cash(50000), gcash(50000)],
            amountTendered: 100000,
            changeGiven: 0,
        });
    });

    it('gives change out of the cash part of a split', () => {
        // ₱700 GCash, then a ₱500 bill for the remaining ₱300.
        expect(
            settleTenders(
                PaymentType.SPLIT,
                [gcash(70000), cash(50000)],
                100000,
            ).changeGiven,
        ).toBe(20000);
    });

    it.each([
        ['cash short of the total', PaymentType.CASH, [cash(79999)], 80000],
        [
            'a split short of the total',
            PaymentType.SPLIT,
            [cash(30000), gcash(60000)],
            100000,
        ],
        ['GCash short of the total', PaymentType.GCASH, [gcash(79999)], 80000],
        ['GCash over the total', PaymentType.GCASH, [gcash(80001)], 80000],
        [
            'a split whose GCash exceeds the total',
            PaymentType.SPLIT,
            [cash(100), gcash(100001)],
            100000,
        ],
        [
            'a split whose GCash already covers the total',
            PaymentType.SPLIT,
            [cash(100), gcash(100000)],
            100000,
        ],
        ['a split with only cash', PaymentType.SPLIT, [cash(100000)], 100000],
        [
            'a split with two cash tenders',
            PaymentType.SPLIT,
            [cash(50000), cash(50000)],
            100000,
        ],
        ['a cash sale paid by GCash', PaymentType.CASH, [gcash(100)], 100],
        [
            'a cash sale with a GCash tender too',
            PaymentType.CASH,
            [cash(100), gcash(100)],
            100,
        ],
        ['a GCash sale paid in cash', PaymentType.GCASH, [cash(100)], 100],
    ])('rejects %s', (_, paymentType, tenders, total) => {
        expect(() => settleTenders(paymentType, tenders, total)).toThrow(
            ValidationError,
        );
    });
});
