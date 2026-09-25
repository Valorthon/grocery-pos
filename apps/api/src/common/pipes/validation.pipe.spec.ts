/**
 * Request text is stored as typed (issue #15). The old global
 * SanitationPipe ran every body string through sanitize-html, which
 * entity-encoded `&`, `<` and `>` (`M&M's` became `M&amp;M's`), and did so
 * before `@MaxLength`. Now the only global pipe is the ValidationPipe from
 * `createValidationPipe`, and whitespace is trimmed per field by the DTOs.
 * These specs run the DTOs through that exact pipe.
 */
import { ArgumentMetadata, BadRequestException, Type } from '@nestjs/common';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { plainToInstance } from 'class-transformer';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';
import { getMetadataStorage } from 'class-validator';
import { Types } from 'mongoose';
import { STRING_LIMITS } from '../../constants';
import { LoginDto } from '../../auth/types/auth.dto';
import {
    ChangePasswordDto,
    CreateBulkDto,
    UpdateBulkDto as UpdateUsersDto,
} from '../../user/types/user.dto';
import {
    MatchesDto,
    NewProductsDto,
    UpdateBulkDto as UpdateProductsDto,
} from '../../product/types/product.dto';
import { RestockDto } from '../../inventory-man/restock/types/restock.dto';
import { AdjustDto } from '../../inventory-man/adjustment/types/adjustment.dto';
import { ReverseSaleDto, SellDto } from '../../sales/types/sales.dto';
import { DiscountType, PaymentType, TenderType } from '../../sales/types';
import {
    CloseShiftDto,
    DrawerMovementDto,
    OpenShiftDto,
} from '../../shift/types/shift.dto';
import { createValidationPipe } from './validation.pipe';
import { routeDtos } from '../testing/route-dtos';

const pipe = createValidationPipe();

function body<T>(metatype: Type<T>, value: unknown): Promise<T> {
    return pipe.transform(value, { type: 'body', metatype }) as Promise<T>;
}

/** The text the issue was filed with. */
const TYPED = `M&M's qty < 10 a>b`;
const PASSWORD = '  p&ss <w>ord>  ';
const ID = new Types.ObjectId().toString();

/** `length` characters of text containing `&`, `<` and `>`. */
function textOf(length: number): string {
    const text = 'tom & jerry <3 a>b ';
    return (
        text.repeat(Math.ceil(length / text.length)).slice(0, length - 1) + 'x'
    );
}

describe('createValidationPipe: text is stored as typed (#15)', () => {
    it('keeps &, < and > and trims the ends', async () => {
        const dto = await body(AdjustDto, {
            description: `  ${TYPED}\n`,
            adjustDetails: [{ product: ID, change: -1, reason: ` ${TYPED} ` }],
        });

        expect(dto.description).toBe(TYPED);
        expect(dto.adjustDetails[0].reason).toBe(TYPED);
    });

    it('does not strip anything that looks like markup', async () => {
        const dto = await body(DrawerMovementDto, {
            type: 'CASH_IN',
            amount: 100,
            reason: '<b>float</b> top-up &amp; change',
        });

        expect(dto.reason).toBe('<b>float</b> top-up &amp; change');
    });

    it('handles nested objects and arrays', async () => {
        const dto = await body(NewProductsDto, {
            newProducts: [
                { name: '  M&M Peanut ', price: 100 },
                { name: 'A<B>C', price: 100 },
            ],
        });

        expect(dto.newProducts.map((p) => p.name)).toEqual([
            'm&m peanut',
            'a<b>c',
        ]);

        const updates = await body(UpdateProductsDto, {
            updates: [{ product: ID, update: { name: ` ${TYPED} ` } }],
        });

        expect(updates.updates[0].update.name).toBe(TYPED.toLowerCase());
    });

    it('trims the restock description, which had no DTO trim before', async () => {
        const dto = await body(RestockDto, {
            description: `  ${TYPED}  `,
            restockDetails: [{ product: ID, quantity: 1, unitCost: 100 }],
        });

        expect(dto.description).toBe(TYPED);
    });

    it('leaves query text alone apart from the DTO trim, as before', async () => {
        const dto = (await pipe.transform({ name: ' M&M ' }, {
            type: 'query',
            metatype: MatchesDto,
        } as ArgumentMetadata)) as MatchesDto;

        // A search for `m&m` now matches a stored `m&m`.
        expect(dto.name).toBe('m&m');
    });

    it('leaves a body without a DTO class untouched', async () => {
        const raw = { note: `  ${TYPED}  ` };

        await expect(
            pipe.transform(raw, { type: 'body', metatype: Object }),
        ).resolves.toEqual(raw);
    });
});

describe('createValidationPipe: MaxLength sees the text as typed (#15)', () => {
    it('accepts a 50-character product name containing &', async () => {
        const name = textOf(STRING_LIMITS.PRODUCT_NAME);
        expect(name).toHaveLength(50);

        const dto = await body(NewProductsDto, {
            newProducts: [{ name: `  ${name}  `, price: 100 }],
        });

        expect(dto.newProducts[0].name).toBe(name);
    });

    it('still rejects a 51-character product name', async () => {
        await expect(
            body(NewProductsDto, {
                newProducts: [
                    { name: textOf(STRING_LIMITS.PRODUCT_NAME + 1), price: 1 },
                ],
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a 100-character discount reason containing &', async () => {
        const reason = textOf(STRING_LIMITS.REASON);
        expect(reason).toHaveLength(100);

        const dto = await body(SellDto, {
            idempotencyKey: '0b6a7d0e-3c1f-4b8a-9d2e-5f4a3b2c1d0e',
            paymentType: PaymentType.CASH,
            tenders: [{ type: TenderType.CASH, amount: 1000 }],
            sellDetails: [{ product: ID, quantity: 1 }],
            discount: {
                type: DiscountType.PERCENT,
                value: 10,
                reason: ` ${reason} `,
            },
        });

        expect(dto.discount?.reason).toBe(reason);
    });

    it('accepts a 100-character void reason containing &', async () => {
        const reason = textOf(STRING_LIMITS.REASON);

        const dto = await body(ReverseSaleDto, { reason });

        expect(dto.reason).toBe(reason);
    });
});

describe('createValidationPipe: passwords pass through verbatim (#15)', () => {
    it('login', async () => {
        const dto = await body(LoginDto, {
            username: '  Cashier ',
            password: PASSWORD,
        });

        expect(dto.username).toBe('cashier');
        expect(dto.password).toBe(PASSWORD);
    });

    it('new users', async () => {
        const dto = await body(CreateBulkDto, {
            users: [
                { name: ' Tom&Jerry ', password: PASSWORD, roles: ['SELLER'] },
            ],
        });

        expect(dto.users[0].name).toBe('tom&jerry');
        expect(dto.users[0].password).toBe(PASSWORD);
    });

    it('admin resets', async () => {
        const dto = await body(UpdateUsersDto, {
            updates: [{ user: ID, update: { password: PASSWORD } }],
        });

        expect(dto.updates[0].update.password).toBe(PASSWORD);
    });

    it('self-service change, both fields', async () => {
        const dto = await body(ChangePasswordDto, {
            currentPassword: PASSWORD,
            newPassword: `\t${PASSWORD}\n`,
        });

        expect(dto.currentPassword).toBe(PASSWORD);
        expect(dto.newPassword).toBe(`\t${PASSWORD}\n`);
    });
});

/**
 * The declared type of every `@Body()` parameter of every route handler
 * under src/. Nested DTOs are then found through their `@Type` metadata, so
 * neither a new body DTO nor a new nested field can go unchecked.
 */
const BODY_DTOS = routeDtos(RouteParamtypes.BODY);

/** Secrets: never trimmed or otherwise transformed. */
const VERBATIM_FIELDS = new Set(['password', 'currentPassword', 'newPassword']);

/** `Class.field` of every `@IsString` field reachable from `roots`. */
function stringFields(roots: Type<unknown>[]): [Type<unknown>, string][] {
    const seen = new Set<Type<unknown>>();
    const out: [Type<unknown>, string][] = [];
    const queue = [...roots];

    while (queue.length > 0) {
        const target = queue.shift()!;
        if (seen.has(target)) continue;
        seen.add(target);

        const metas = getMetadataStorage().getTargetValidationMetadatas(
            target,
            '',
            true,
            false,
        );
        const fields = new Set(metas.map((m) => m.propertyName));
        for (const field of fields) {
            const nested = defaultMetadataStorage.findTypeMetadata(
                target,
                field,
            );
            const nestedType = nested?.typeFunction() as
                Type<unknown> | undefined;
            if (nestedType && nestedType !== Number) queue.push(nestedType);

            if (
                metas.some(
                    (m) => m.propertyName === field && m.name === 'isString',
                )
            ) {
                out.push([target, field]);
            }
        }
    }
    return out;
}

/** What class-transformer (inside the pipe) makes of `value` in `field`. */
function transformed(
    target: Type<unknown>,
    field: string,
    value: string,
): unknown {
    const instance = plainToInstance(target, { [field]: value }) as Record<
        string,
        unknown
    >;
    return instance[field];
}

describe('body DTO string fields (#15)', () => {
    const fields = stringFields(BODY_DTOS);

    it('finds every @Body() DTO of the controllers', () => {
        expect(BODY_DTOS.length).toBeGreaterThanOrEqual(13);
        expect(BODY_DTOS).toEqual(
            expect.arrayContaining([
                LoginDto,
                CreateBulkDto,
                UpdateUsersDto,
                ChangePasswordDto,
                NewProductsDto,
                UpdateProductsDto,
                RestockDto,
                AdjustDto,
                SellDto,
                ReverseSaleDto,
                OpenShiftDto,
                CloseShiftDto,
                DrawerMovementDto,
            ]),
        );
    });

    it('finds the nested DTOs too', () => {
        const names = fields.map(([t, f]) => `${t.name}.${f}`);

        expect(names).toEqual(
            expect.arrayContaining([
                'DiscountFields.reason',
                'AdjustFields.reason',
                'NewProductFields.name',
            ]),
        );
    });

    it.each(fields.map(([t, f]) => [`${t.name}.${f}`, t, f] as const))(
        '%s: trimmed, or verbatim if it is a secret',
        (_label, target, field) => {
            const padded = '  ab  ';

            expect(transformed(target, field, padded)).toBe(
                VERBATIM_FIELDS.has(field) ? padded : 'ab',
            );
        },
    );
});
