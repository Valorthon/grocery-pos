import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validate } from 'class-validator';
import {
    BARCODE_MESSAGES,
    barcodeError,
    gtinCheckDigit,
    hasValidCheckDigit,
    isReservedBarcode,
} from '@grocery-pos/contracts';
import { AtLeastOneOf, ExactlyOneOf, IsBarcode } from './validators';

@ExactlyOneOf(['a', 'b'])
class OneOf {
    @IsOptional()
    @IsString()
    a?: string;

    @IsOptional()
    @IsString()
    b?: string;
}

@AtLeastOneOf(['a', 'b'])
class AnyOf {
    @IsOptional()
    @IsString()
    a?: string;

    @IsOptional()
    @IsString()
    b?: string;
}

class WithBarcode {
    @IsBarcode()
    code!: unknown;
}

async function messages(cls: new () => object, plain: object) {
    const errors = await validate(plainToInstance(cls, plain), {
        whitelist: true,
        forbidNonWhitelisted: true,
    });
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('ExactlyOneOf (issue #14)', () => {
    it.each([[{ a: 'x' }], [{ b: 'y' }]])(
        'accepts exactly one: %p',
        async (plain) => {
            expect(await messages(OneOf, plain)).toEqual([]);
        },
    );

    it('refuses both', async () => {
        expect(await messages(OneOf, { a: 'x', b: 'y' })).toEqual([
            'Exactly one of the following must be provided: a, b',
        ]);
    });

    it.each([[{}], [{ a: '', b: null }]])(
        'refuses neither: %p',
        async (plain) => {
            expect(await messages(OneOf, plain)).toEqual([
                'Exactly one of the following must be provided: a, b',
            ]);
        },
    );

    it('refuses any value sent under its synthetic key', async () => {
        // The key is registered (so whitelisted), but can carry nothing.
        const errors = await messages(OneOf, {
            a: 'x',
            'exactlyOneOf(a,b)': { anything: true },
        });

        expect(errors).toEqual([
            'Exactly one of the following must be provided: a, b',
        ]);
    });

    it('still forbids unknown properties such as the old `dummy`', async () => {
        expect(await messages(OneOf, { a: 'x', dummy: 1 })).toEqual([
            'property dummy should not exist',
        ]);
    });
});

describe('AtLeastOneOf', () => {
    it('accepts one or both', async () => {
        expect(await messages(AnyOf, { a: 'x' })).toEqual([]);
        expect(await messages(AnyOf, { a: 'x', b: 'y' })).toEqual([]);
    });

    it('refuses none', async () => {
        expect(await messages(AnyOf, {})).toEqual([
            'At least one of the following must be provided: a, b',
        ]);
    });
});

/**
 * The barcode rules live in @grocery-pos/contracts (which has no test
 * runner of its own); they are pinned here, next to the decorator that
 * applies them to the DTOs.
 */
describe('barcode rules (contracts, issue #14)', () => {
    it.each([
        ['EAN-13', '4006381333931'],
        ['EAN-13', '4800016644504'],
        ['UPC-A', '036000291452'],
        ['UPC-A', '012345678905'],
        ['EAN-8', '96385074'],
        ['EAN-8', '40170725'],
    ])('accepts a valid %s: %s', (_kind, code) => {
        expect(barcodeError(code)).toBeNull();
    });

    it.each([
        ['EAN-13', '4006381333932'],
        ['UPC-A', '036000291453'],
        ['EAN-8', '96385075'],
    ])('rejects a %s with a wrong check digit: %s', (_kind, code) => {
        expect(barcodeError(code)).toBe(BARCODE_MESSAGES.CHECK_DIGIT);
    });

    it.each([
        ['letters', 'abcdefghijklm'],
        ['mixed', '400638133393a'],
        ['a space', '4006381 33931'],
        ['a sign', '-12345678'],
        ['empty', ''],
        ['7 digits', '1234567'],
        ['9 digits', '123456789'],
        ['11 digits', '12345678901'],
        ['14 digits', '40063813339310'],
    ])('rejects %s as a format error', (_label, code) => {
        expect(barcodeError(code)).toBe(BARCODE_MESSAGES.FORMAT);
    });

    it('refuses a typed code in the generated range, even with a valid check digit', () => {
        // 200 + 000000001 + check digit 5: what the counter hands out first.
        expect(hasValidCheckDigit('2000000000015')).toBe(true);
        expect(isReservedBarcode('2000000000015')).toBe(true);
        expect(barcodeError('2000000000015')).toBe(BARCODE_MESSAGES.RESERVED);
        expect(BARCODE_MESSAGES.RESERVED).toContain('200');
    });

    it('reserves only 13-digit codes: a UPC-A or EAN-8 starting 200 is fine', () => {
        const upc = `20000000000${gtinCheckDigit('20000000000')}`;
        const ean8 = `2000000${gtinCheckDigit('2000000')}`;

        expect(isReservedBarcode(upc)).toBe(false);
        expect(barcodeError(upc)).toBeNull();
        expect(barcodeError(ean8)).toBeNull();
    });

    it('computes the GS1 check digit from the right for every length', () => {
        expect(gtinCheckDigit('400638133393')).toBe(1);
        expect(gtinCheckDigit('03600029145')).toBe(2);
        expect(gtinCheckDigit('9638507')).toBe(4);
    });
});

describe('IsBarcode', () => {
    it('accepts a valid code', async () => {
        expect(await messages(WithBarcode, { code: '4006381333931' })).toEqual(
            [],
        );
    });

    it.each([
        ['4006381333932', BARCODE_MESSAGES.CHECK_DIGIT],
        ['2000000000015', BARCODE_MESSAGES.RESERVED],
        ['abc', BARCODE_MESSAGES.FORMAT],
        [12345678, BARCODE_MESSAGES.FORMAT],
    ])('rejects %p with the rule that failed', async (code, message) => {
        expect(await messages(WithBarcode, { code })).toEqual([message]);
    });
});
