import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { STRING_LIMITS } from '../../constants';
import { GetDto, MatchesDto, NewProductFields } from './product.dto';

async function priceErrors(price: unknown) {
    const dto = plainToInstance(NewProductFields, { name: 'bread', price });
    const errors = await validate(dto);
    return errors.filter((e) => e.property === 'price');
}

describe('NewProductFields.price', () => {
    it('accepts a whole number of centavos', async () => {
        expect(await priceErrors(1999)).toHaveLength(0);
    });

    it('rejects fractional money, which would be pesos or a float artifact', async () => {
        const [error] = await priceErrors(19.99);

        expect(error?.constraints).toHaveProperty('isInt');
    });

    it('rejects a free product', async () => {
        const [error] = await priceErrors(0);

        expect(error?.constraints).toHaveProperty('min');
    });
});

async function propertyErrors<T extends object>(
    cls: new () => T,
    plain: Record<string, unknown>,
    property: string,
) {
    const errors = await validate(plainToInstance(cls, plain));
    return errors.filter((e) => e.property === property);
}

describe('MatchesDto', () => {
    it('lowercases and trims the name, as names are stored', () => {
        const dto = plainToInstance(MatchesDto, { name: '  MILK ' });

        expect(dto.name).toBe('milk');
    });

    it('accepts a name up to the product-name limit', async () => {
        const name = 'a'.repeat(STRING_LIMITS.PRODUCT_NAME);

        expect(await propertyErrors(MatchesDto, { name }, 'name')).toHaveLength(
            0,
        );
    });

    it('rejects a name longer than any product name', async () => {
        const name = 'a'.repeat(STRING_LIMITS.PRODUCT_NAME + 1);
        const [error] = await propertyErrors(MatchesDto, { name }, 'name');

        expect(error?.constraints).toHaveProperty('maxLength');
    });

    it('rejects a non-string name', async () => {
        const [error] = await propertyErrors(
            MatchesDto,
            { name: ['a'] },
            'name',
        );

        expect(error?.constraints).toHaveProperty('isString');
    });

    it('rejects an EAN longer than 13 characters', async () => {
        const EAN = '1'.repeat(STRING_LIMITS.EAN + 1);
        const [error] = await propertyErrors(MatchesDto, { EAN }, 'EAN');

        expect(error?.constraints).toHaveProperty('maxLength');
    });
});

describe('GetDto', () => {
    it('accepts a 13-digit EAN', async () => {
        expect(
            await propertyErrors(GetDto, { EAN: '2000000000015' }, 'EAN'),
        ).toHaveLength(0);
    });

    it('rejects a code longer than an EAN', async () => {
        const [error] = await propertyErrors(
            GetDto,
            { EAN: '2'.repeat(STRING_LIMITS.EAN + 1) },
            'EAN',
        );

        expect(error?.constraints).toHaveProperty('maxLength');
    });
});
