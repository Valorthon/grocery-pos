import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetAllDto, GetDetailsQueryDto, RestockFields } from './restock.dto';

async function unitCostErrors(unitCost: unknown) {
    const dto = plainToInstance(RestockFields, {
        product: '507f1f77bcf86cd799439011',
        quantity: 3,
        unitCost,
    });
    const errors = await validate(dto);
    return errors.filter((e) => e.property === 'unitCost');
}

describe('RestockFields.unitCost', () => {
    it('accepts a whole number of centavos', async () => {
        expect(await unitCostErrors(1999)).toHaveLength(0);
    });

    it('rejects fractional money', async () => {
        const [error] = await unitCostErrors(19.99);

        expect(error?.constraints).toHaveProperty('isInt');
    });

    it('rejects a zero cost', async () => {
        const [error] = await unitCostErrors(0);

        expect(error?.constraints).toHaveProperty('min');
    });
});

describe('GetAllDto date filter', () => {
    async function dateErrors(query: Record<string, unknown>) {
        const dto = plainToInstance(GetAllDto, { page: 1, limit: 5, ...query });
        const errors = await validate(dto);
        return errors.filter(
            (e) => e.property === 'dateFrom' || e.property === 'dateTo',
        );
    }

    it('accepts YYYY-MM-DD on either end alone', async () => {
        expect(await dateErrors({ dateFrom: '2026-01-05' })).toHaveLength(0);
        expect(await dateErrors({ dateTo: '2026-01-05' })).toHaveLength(0);
    });

    it('rejects instants and impossible dates', async () => {
        expect(
            await dateErrors({ dateFrom: '2026-01-05T00:00:00.000Z' }),
        ).toHaveLength(1);
        expect(await dateErrors({ dateTo: '2026-02-30' })).toHaveLength(1);
    });
});

describe('RestockFields: exactly one of newProduct and product (issue #14)', () => {
    const PRODUCT = '507f1f77bcf86cd799439011';
    const NEW_PRODUCT = { name: 'bread', price: 1999 };
    const LINE = { quantity: 3, unitCost: 1000 };

    async function errorsFor(plain: Record<string, unknown>) {
        const errors = await validate(
            plainToInstance(RestockFields, { ...LINE, ...plain }),
            { whitelist: true, forbidNonWhitelisted: true },
        );
        return errors.flatMap((e) => Object.values(e.constraints ?? {}));
    }

    const ONE_OF =
        'Exactly one of the following must be provided: newProduct, product';

    it('accepts an existing product alone', async () => {
        expect(await errorsFor({ product: PRODUCT })).toEqual([]);
    });

    it('accepts a new product alone', async () => {
        expect(await errorsFor({ newProduct: NEW_PRODUCT })).toEqual([]);
    });

    it('refuses both, which used to create a product with no stock row', async () => {
        expect(
            await errorsFor({ product: PRODUCT, newProduct: NEW_PRODUCT }),
        ).toEqual([ONE_OF]);
    });

    it('refuses neither', async () => {
        expect(await errorsFor({})).toEqual([ONE_OF]);
    });

    it('no longer accepts a `dummy` property', async () => {
        expect(
            await errorsFor({ product: PRODUCT, dummy: { any: 'payload' } }),
        ).toEqual(['property dummy should not exist']);
    });

    it('validates the new product’s barcode', async () => {
        const errors = await validate(
            plainToInstance(RestockFields, {
                ...LINE,
                newProduct: { ...NEW_PRODUCT, EAN: 'abc' },
            }),
        );

        expect(errors.map((e) => e.property)).toEqual(['newProduct']);
    });
});

describe('GetDetailsQueryDto search', () => {
    it('lowercases and trims the name, as names are stored', () => {
        const dto = plainToInstance(GetDetailsQueryDto, {
            name: '  MILK ',
            EAN: ' 480 ',
        });

        expect(dto.name).toBe('milk');
        expect(dto.EAN).toBe('480');
    });
});
