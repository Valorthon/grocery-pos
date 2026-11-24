import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { PRODUCT_NAME_CHARACTERS_MESSAGE } from '@grocery-pos/contracts';
import { STRING_LIMITS } from '../../constants';
import {
    GetDto,
    MatchesDto,
    NewProductFields,
    UpdateBulkDto,
} from './product.dto';

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
    it('uppercases and trims the name, as names are stored (#443)', () => {
        const dto = plainToInstance(MatchesDto, { name: '  milk ' });

        expect(dto.name).toBe('MILK');
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

    it.each(['036000291452', '96385074'])(
        'accepts a UPC-A or EAN-8 as scanned: %s (#87)',
        async (EAN) => {
            expect(await propertyErrors(GetDto, { EAN }, 'EAN')).toHaveLength(
                0,
            );
        },
    );

    it('rejects a code longer than an EAN', async () => {
        const [error] = await propertyErrors(
            GetDto,
            { EAN: '2'.repeat(STRING_LIMITS.EAN + 1) },
            'EAN',
        );

        expect(error?.constraints).toHaveProperty('maxLength');
    });
});

describe('NewProductFields.EAN (issue #14)', () => {
    async function eanErrors(EAN: unknown) {
        return propertyErrors(
            NewProductFields,
            { name: 'bread', price: 1999, EAN },
            'EAN',
        );
    }

    it.each([
        ['EAN-13', '4006381333931'],
        ['UPC-A', '036000291452'],
        ['EAN-8', '96385074'],
    ])('accepts a valid %s, stored as scanned', async (_kind, EAN) => {
        const dto = plainToInstance(NewProductFields, {
            name: 'bread',
            price: 1999,
            EAN: ` ${EAN} `,
        });

        expect(dto.EAN).toBe(EAN);
        expect(await eanErrors(EAN)).toHaveLength(0);
    });

    it.each([
        ['letters', 'abc'],
        ['a bad check digit', '4006381333932'],
        ['a code in the generated range', '2000000000015'],
        ['a wrong length', '12345'],
    ])('rejects %s', async (_label, EAN) => {
        const [error] = await eanErrors(EAN);

        expect(error?.constraints).toHaveProperty('isBarcode');
    });

    it('treats a blank barcode as absent, so the server generates one', async () => {
        const dto = plainToInstance(NewProductFields, {
            name: 'bread',
            price: 1999,
            EAN: '   ',
        });

        expect(dto.EAN).toBeUndefined();
        expect(await validate(dto)).toHaveLength(0);
    });
});

describe('UpdateBulkDto: no empty updates (issue #14)', () => {
    async function messages(update: Record<string, unknown>) {
        const errors = await validate(
            plainToInstance(UpdateBulkDto, {
                updates: [{ product: '507f1f77bcf86cd799439011', update }],
            }),
        );
        const flat = (e: ValidationError): string[] => [
            ...Object.values(e.constraints ?? {}),
            ...(e.children ?? []).flatMap(flat),
        ];
        return errors.flatMap(flat);
    }

    it('rejects an update with no fields, which would be an empty $set', async () => {
        expect(await messages({})).toEqual([
            'At least one of the following must be provided: name, price, category, isActive, reorderLevel, reorderQuantity, tracksExpiry',
        ]);
    });

    it('rejects an update whose only field is null', async () => {
        expect(await messages({ price: null })).toContain(
            'At least one of the following must be provided: name, price, category, isActive, reorderLevel, reorderQuantity, tracksExpiry',
        );
    });

    it('rejects a line with no update object at all', async () => {
        const errors = await validate(
            plainToInstance(UpdateBulkDto, {
                updates: [{ product: '507f1f77bcf86cd799439011' }],
            }),
        );
        const [line] = errors[0]?.children?.[0]?.children ?? [];

        expect(line?.property).toBe('update');
        expect(line?.constraints).toHaveProperty('isDefined');
    });

    it('rejects an update that is not an object', async () => {
        const errors = await validate(
            plainToInstance(UpdateBulkDto, {
                updates: [{ product: '507f1f77bcf86cd799439011', update: 'x' }],
            }),
        );
        const [line] = errors[0]?.children?.[0]?.children ?? [];

        expect(line?.constraints).toHaveProperty('isObject');
    });

    it('accepts a name or a price', async () => {
        expect(await messages({ name: 'milk' })).toEqual([]);
        expect(await messages({ price: 1999 })).toEqual([]);
    });
});

describe('reorder settings validation', () => {
    it('allows zero reorder level and positive safe integer minor quantities', async () => {
        for (const [property, value] of [
            ['reorderLevel', 0],
            ['reorderQuantity', 450],
        ] as const) {
            expect(
                await propertyErrors(
                    NewProductFields,
                    { name: 'rice', price: 100, [property]: value },
                    property,
                ),
            ).toHaveLength(0);
        }
    });
    it('rejects null, fractions, unsafe integers and invalid quantity bounds', async () => {
        for (const value of [null, 0.5, Number.MAX_SAFE_INTEGER + 1, -1]) {
            expect(
                await propertyErrors(
                    NewProductFields,
                    { name: 'rice', price: 100, reorderLevel: value },
                    'reorderLevel',
                ),
            ).not.toHaveLength(0);
        }
        expect(
            await propertyErrors(
                NewProductFields,
                { name: 'rice', price: 100, reorderQuantity: 0 },
                'reorderQuantity',
            ),
        ).not.toHaveLength(0);
    });
    it('accepts an edit consisting only of reorder settings', async () => {
        const dto = plainToInstance(UpdateBulkDto, {
            updates: [
                {
                    product: '507f1f77bcf86cd799439011',
                    update: { reorderLevel: 0, reorderQuantity: 5 },
                },
            ],
        });
        expect(await validate(dto)).toHaveLength(0);
    });
});

describe('product name characters (#483)', () => {
    it('accepts letters with accents, digits and the allowed symbols', async () => {
        const name = "Piña Café 1/2 (5kg) 10% A&B, Mama's. X-1";
        expect(
            await propertyErrors(
                NewProductFields,
                { name, price: 100 },
                'name',
            ),
        ).toHaveLength(0);
    });

    it.each(['QA 🍎 APPLE', 'A<B>', 'A$', 'A#'])(
        'refuses %j on create and on edit',
        async (name) => {
            const [created] = await propertyErrors(
                NewProductFields,
                { name, price: 100 },
                'name',
            );
            expect(created?.constraints?.isProductName).toBe(
                PRODUCT_NAME_CHARACTERS_MESSAGE,
            );
            const dto = plainToInstance(UpdateBulkDto, {
                updates: [
                    { product: '507f1f77bcf86cd799439011', update: { name } },
                ],
            });
            expect(JSON.stringify(await validate(dto))).toContain(
                'isProductName',
            );
        },
    );

    it("stores a curly apostrophe and no-break space plainly (MAMA’S → MAMA'S)", async () => {
        const dto = plainToInstance(NewProductFields, {
            name: 'Mama\u2019s\u00A0rice',
            price: 100,
        });
        expect(dto.name).toBe("MAMA'S RICE");
        expect(await validate(dto)).toHaveLength(0);
    });

    it('lets an edit without a name through (a legacy name stays)', async () => {
        const dto = plainToInstance(UpdateBulkDto, {
            updates: [
                { product: '507f1f77bcf86cd799439011', update: { price: 5 } },
            ],
        });
        expect(await validate(dto)).toHaveLength(0);
    });
});
