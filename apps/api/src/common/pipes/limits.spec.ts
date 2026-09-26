/**
 * Request size bounds (issue #16): every paginated query caps `limit` at
 * PAGINATION.LIMIT_MAX, and every list in a request body carries an
 * `@ArrayMaxSize`, so one request can neither read nor write without bound.
 * The walkers find every DTO from the controllers, so a new route cannot
 * skip the caps; the table then drives each capped body through the global
 * pipe.
 */
import { BadRequestException, Type } from '@nestjs/common';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { plainToInstance } from 'class-transformer';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';
import { getMetadataStorage, validate } from 'class-validator';
import type { ValidationMetadata } from 'class-validator/types/metadata/ValidationMetadata';
import { Types } from 'mongoose';
import { ASSIGNABLE_ROLES } from '@grocery-pos/contracts';
import { BATCH_LIMITS, PAGINATION } from '../../constants';
import { createValidationPipe } from './validation.pipe';
import { routeDtos } from '../testing/route-dtos';
import {
    CreateBulkDto,
    UpdateBulkDto as UpdateUsersDto,
    GetUsersDto as UsersQuery,
} from '../../user/types/user.dto';
import {
    NewProductsDto,
    UpdateBulkDto as UpdateProductsDto,
    GetAllDto as ProductsQuery,
} from '../../product/types/product.dto';
import {
    RestockDto,
    GetAllDto as RestocksQuery,
    GetDetailsQueryDto as RestockDetailsQuery,
} from '../../inventory-man/restock/types/restock.dto';
import {
    AdjustDto,
    GetAllDto as AdjustmentsQuery,
    GetDetailsQueryDto as AdjustmentDetailsQuery,
} from '../../inventory-man/adjustment/types/adjustment.dto';
import { GetAllDto as InventoryQuery } from '../../inventory-man/inventory/types/inventory.dto';
import { GetAllDto as SalesQuery, SellDto } from '../../sales/types/sales.dto';
import { PaymentType, TenderType } from '../../sales/types';
import { ListShiftsDto } from '../../shift/types/shift.dto';
import { Role } from '../../auth/types';

const pipe = createValidationPipe();

function metasOf(target: Type<unknown>): ValidationMetadata[] {
    return getMetadataStorage().getTargetValidationMetadatas(
        target,
        '',
        true,
        false,
    );
}

/** `target` and every DTO nested in it through `@Type`. */
function withNested(roots: Type<unknown>[]): Type<unknown>[] {
    const seen = new Set<Type<unknown>>();
    const queue = [...roots];
    while (queue.length > 0) {
        const target = queue.shift()!;
        if (seen.has(target)) continue;
        seen.add(target);
        for (const field of new Set(
            metasOf(target).map((m) => m.propertyName),
        )) {
            const nested = defaultMetadataStorage
                .findTypeMetadata(target, field)
                ?.typeFunction() as Type<unknown> | undefined;
            if (nested && nested !== Number && nested !== String) {
                queue.push(nested);
            }
        }
    }
    return [...seen];
}

/** The constraint of `name` on `target.field`, if any. */
function constraint(target: Type<unknown>, field: string, name: string) {
    return metasOf(target).find(
        (m) => m.propertyName === field && m.name === name,
    )?.constraints?.[0] as unknown;
}

/** Fields validated as lists: `@IsArray`, `@ArrayNotEmpty` or nested `each`. */
function arrayFields(target: Type<unknown>): string[] {
    return [
        ...new Set(
            metasOf(target)
                .filter(
                    (m) =>
                        m.name === 'isArray' ||
                        m.name === 'arrayNotEmpty' ||
                        (m.type === 'nestedValidation' && m.each),
                )
                .map((m) => m.propertyName),
        ),
    ];
}

describe('pagination cap (#16)', () => {
    const QUERY_DTOS = routeDtos(RouteParamtypes.QUERY);
    const paginated = QUERY_DTOS.filter((t) =>
        metasOf(t).some((m) => m.propertyName === 'limit'),
    );

    it('finds every paginated query DTO', () => {
        expect(paginated).toEqual(
            expect.arrayContaining([
                SalesQuery,
                UsersQuery,
                ProductsQuery,
                InventoryQuery,
                RestocksQuery,
                RestockDetailsQuery,
                AdjustmentsQuery,
                AdjustmentDetailsQuery,
                ListShiftsDto,
            ]),
        );
    });

    it('keeps the cap at 100, above every page size the client asks for', () => {
        expect(PAGINATION.LIMIT_MAX).toBe(100);
    });

    it.each(paginated.map((t) => [t.name, t] as const))(
        '%s caps limit at PAGINATION.LIMIT_MAX',
        async (_, target) => {
            const errorsAt = async (limit: string) =>
                (
                    await validate(
                        plainToInstance(
                            target,
                            { page: '1', limit },
                            { enableImplicitConversion: true },
                        ) as object,
                    )
                ).find((e) => e.property === 'limit')?.constraints;

            expect(constraint(target, 'limit', 'max')).toBe(
                PAGINATION.LIMIT_MAX,
            );
            expect(
                await errorsAt(String(PAGINATION.LIMIT_MAX)),
            ).toBeUndefined();
            expect(
                await errorsAt(String(PAGINATION.LIMIT_MAX + 1)),
            ).toHaveProperty('max');
            expect(await errorsAt('1000000')).toHaveProperty('max');
        },
    );

    it('keeps the page cap at 10,000, a skip of at most 999,900 rows', () => {
        expect(PAGINATION.PAGE_MAX).toBe(10_000);
    });

    it.each(paginated.map((t) => [t.name, t] as const))(
        '%s takes whole numbers only, and caps page at PAGINATION.PAGE_MAX',
        async (_, target) => {
            const errorsOf = async (
                field: 'page' | 'limit',
                query: Record<string, string>,
            ) =>
                (
                    await validate(
                        plainToInstance(target, query, {
                            enableImplicitConversion: true,
                        }) as object,
                    )
                ).find((e) => e.property === field)?.constraints;

            expect(constraint(target, 'page', 'max')).toBe(PAGINATION.PAGE_MAX);
            expect(
                await errorsOf('page', {
                    page: String(PAGINATION.PAGE_MAX),
                    limit: '5',
                }),
            ).toBeUndefined();
            expect(
                await errorsOf('page', {
                    page: String(PAGINATION.PAGE_MAX + 1),
                    limit: '5',
                }),
            ).toHaveProperty('max');
            expect(
                await errorsOf('page', { page: '1e20', limit: '5' }),
            ).toHaveProperty('max');
            expect(
                await errorsOf('page', { page: '1.5', limit: '5' }),
            ).toHaveProperty('isInt');
            expect(
                await errorsOf('limit', { page: '1', limit: '2.5' }),
            ).toHaveProperty('isInt');
        },
    );

    it('answers limit=1000000 with a 400 through the global pipe', async () => {
        await expect(
            pipe.transform(
                { page: '1', limit: '1000000' },
                { type: 'query', metatype: ProductsQuery },
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});

describe('body list caps (#16)', () => {
    const DTOS = withNested(routeDtos(RouteParamtypes.BODY));
    const lists = DTOS.flatMap((t) =>
        arrayFields(t).map((f) => [`${t.name}.${f}`, t, f] as const),
    );

    it('finds the lists of every body DTO', () => {
        expect(lists.map(([label]) => label)).toEqual(
            expect.arrayContaining([
                'SellDto.sellDetails',
                'SellDto.tenders',
                'RestockDto.restockDetails',
                'AdjustDto.adjustDetails',
                'NewProductsDto.newProducts',
                'CreateBulkDto.users',
            ]),
        );
    });

    it.each(lists)('%s has an @ArrayMaxSize', (_, target, field) => {
        expect(constraint(target, field, 'arrayMaxSize')).toEqual(
            expect.any(Number),
        );
    });

    it('bounds lists at grocery-register sizes', () => {
        expect(BATCH_LIMITS).toEqual({
            SALE_LINES: 200,
            RESTOCK_LINES: 200,
            ADJUSTMENT_LINES: 200,
            NEW_PRODUCTS: 200,
            PRODUCT_UPDATES: 200,
            USERS: 50,
        });
        expect(constraint(SellDto, 'tenders', 'arrayMaxSize')).toBe(
            Object.keys(TenderType).length,
        );
    });

    const ID = () => new Types.ObjectId().toString();
    const times = <T>(n: number, make: (i: number) => T) =>
        Array.from({ length: n }, (_, i) => make(i));

    /** A valid body with `n` list entries, per capped list. */
    const CASES: Array<
        [string, Type<unknown>, string, number, (n: number) => object]
    > = [
        [
            'SellDto.sellDetails',
            SellDto,
            'sellDetails',
            BATCH_LIMITS.SALE_LINES,
            (n) => ({
                idempotencyKey: '3f2b8c1e-9d4a-4e6b-8f7c-2a1d0e9b8c7d',
                paymentType: PaymentType.CASH,
                tenders: [{ type: TenderType.CASH, amount: 100 }],
                sellDetails: times(n, () => ({ product: ID(), quantity: 1 })),
            }),
        ],
        [
            'RestockDto.restockDetails',
            RestockDto,
            'restockDetails',
            BATCH_LIMITS.RESTOCK_LINES,
            (n) => ({
                description: 'delivery',
                restockDetails: times(n, () => ({
                    product: ID(),
                    quantity: 1,
                    unitCost: 100,
                })),
            }),
        ],
        [
            'AdjustDto.adjustDetails',
            AdjustDto,
            'adjustDetails',
            BATCH_LIMITS.ADJUSTMENT_LINES,
            (n) => ({
                description: 'count',
                adjustDetails: times(n, () => ({
                    product: ID(),
                    change: -1,
                    reason: 'broken',
                })),
            }),
        ],
        [
            'NewProductsDto.newProducts',
            NewProductsDto,
            'newProducts',
            BATCH_LIMITS.NEW_PRODUCTS,
            (n) => ({
                newProducts: times(n, (i) => ({
                    name: `item ${i}`,
                    price: 100,
                })),
            }),
        ],
        [
            'UpdateBulkDto.updates (products)',
            UpdateProductsDto,
            'updates',
            BATCH_LIMITS.PRODUCT_UPDATES,
            (n) => ({
                updates: times(n, () => ({
                    product: ID(),
                    update: { name: 'renamed' },
                })),
            }),
        ],
        [
            'CreateBulkDto.users',
            CreateBulkDto,
            'users',
            BATCH_LIMITS.USERS,
            (n) => ({
                users: times(n, (i) => ({
                    name: `user${i}`,
                    password: 'password1',
                    roles: [Role.Seller],
                })),
            }),
        ],
        [
            'UpdateBulkDto.updates (users)',
            UpdateUsersDto,
            'updates',
            BATCH_LIMITS.USERS,
            (n) => ({
                updates: times(n, () => ({
                    user: ID(),
                    update: { isActive: true },
                })),
            }),
        ],
    ];

    const run = (metatype: Type<unknown>, value: object) =>
        pipe.transform(value, { type: 'body', metatype });

    describe.each(CASES)('%s', (_, metatype, field, max, make) => {
        it(`accepts exactly ${max} entries`, async () => {
            await expect(run(metatype, make(max))).resolves.toBeInstanceOf(
                metatype,
            );
        });

        it(`refuses ${max + 1} entries with a 400 naming the cap`, async () => {
            const error = (await run(metatype, make(max + 1)).catch(
                (e: unknown) => e,
            )) as BadRequestException;

            expect(error).toBeInstanceOf(BadRequestException);
            expect(JSON.stringify(error.getResponse())).toContain(
                `${field} must contain no more than ${max} elements`,
            );
        });
    });

    it('caps a user’s roles at the assignable roles', () => {
        expect(
            constraint(
                withNested([CreateBulkDto]).find(
                    (t) => t.name === 'CreateFields',
                )!,
                'roles',
                'arrayMaxSize',
            ),
        ).toBe(ASSIGNABLE_ROLES.length);
    });
});
