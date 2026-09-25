/**
 * The product payloads the client builds, over real HTTP (issue #33).
 *
 * The global ValidationPipe refuses any property a DTO does not declare
 * (`forbidNonWhitelisted`). The client used to send whole form drafts, so
 * adding a product draft (ensureValid) and saving drafts (bulk) failed on
 * every attempt. The fixtures below duplicate what the client's mappers in
 * apps/client/src/utils/payloads.ts build (checked there by
 * payloads.spec.ts); keep the two in step.
 */
import { ErrorCode } from '../common/errors';
import { Role } from '../auth/types';
import {
    AccessHarness,
    bootAccessHarness,
    caller,
} from '../common/testing/access-harness';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

/** What axios sends for `params`: undefined keys are left out. */
function query(
    params: Record<string, string | number | boolean | undefined>,
): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) search.append(key, String(value));
    }
    return search.toString();
}

// toEnsureValidQuery(draft)
const ENSURE_TYPED = {
    EAN: '4006381333931',
    name: 'Bread',
    autoGenerateEAN: false,
};
const ENSURE_AUTO = { name: 'Milk', autoGenerateEAN: true };

// toNewProductsBody(drafts)
const BULK = {
    newProducts: [
        { EAN: '4006381333931', name: 'Bread', price: 1999 },
        { name: 'Milk', price: 5000 },
    ],
};

describe('Product payloads from the client (e2e, issue #33)', () => {
    let harness: AccessHarness;

    const findOne = jest.fn();
    // The real ensureValid over a faked model: the lookup is under test too.
    const realEnsureValid = ProductService.prototype.ensureValid.bind({
        model: { findOne },
    } as unknown as ProductService);

    const service = {
        ensureValid: jest.fn(realEnsureValid),
        addMany: jest.fn().mockResolvedValue(undefined),
    };

    beforeAll(async () => {
        harness = await bootAccessHarness(
            [ProductController],
            [{ provide: ProductService, useValue: service }],
        );
    });

    afterAll(async () => {
        await harness.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    });

    const restocker = () => caller(Role.Restocker);

    function ensureValid(
        params: Record<string, string | number | boolean | undefined>,
    ) {
        return harness.call(
            restocker(),
            'GET',
            `/products/ensureValid?${query(params)}`,
        );
    }

    async function validationMessages(res: Response): Promise<string[]> {
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
            error: string;
            details: { messages: string[] };
        };
        expect(body.error).toBe(ErrorCode.VALIDATION_INVALID_INPUT);
        return body.details.messages;
    }

    describe('GET /products/ensureValid', () => {
        it('accepts a typed barcode draft and looks up both fields', async () => {
            const res = await ensureValid(ENSURE_TYPED);

            expect(res.status).toBe(200);
            expect(service.ensureValid).toHaveBeenCalledWith({
                EAN: '4006381333931',
                name: 'bread',
                autoGenerateEAN: false,
            });
            expect(findOne).toHaveBeenCalledWith({
                $or: [{ EAN: '4006381333931' }, { name: 'bread' }],
            });
        });

        it('accepts an auto-generated draft and looks up the name only', async () => {
            const res = await ensureValid(ENSURE_AUTO);

            expect(res.status).toBe(200);
            expect(findOne).toHaveBeenCalledWith({ $or: [{ name: 'milk' }] });
        });

        it('says which field already exists', async () => {
            findOne.mockReturnValue({
                lean: () =>
                    Promise.resolve({ EAN: '2000000000015', name: 'milk' }),
            });

            const res = await ensureValid(ENSURE_AUTO);
            const body = (await res.json()) as {
                error: string;
                details: unknown;
            };

            expect(res.status).toBe(400);
            expect(body.error).toBe(ErrorCode.PRODUCT_DUPLICATE);
            expect(body.details).toEqual(['name already exists']);
        });

        describe('the old whole-form queries (regression)', () => {
            it('refused the product dialog form: price is not a field', async () => {
                const messages = await validationMessages(
                    await ensureValid({ ...ENSURE_TYPED, price: 19.99 }),
                );

                expect(messages).toEqual(['property price should not exist']);
                expect(service.ensureValid).not.toHaveBeenCalled();
            });

            it('refused the restock dialog form', async () => {
                const messages = await validationMessages(
                    await ensureValid({
                        ...ENSURE_TYPED,
                        quantity: 3,
                        unitCost: 10,
                        isNewProduct: true,
                        name: 'Bread',
                        price: 19.99,
                        product: '',
                    }),
                );

                expect(messages).toEqual(
                    expect.arrayContaining([
                        'property quantity should not exist',
                        'property unitCost should not exist',
                        'property isNewProduct should not exist',
                        'property price should not exist',
                        'property product should not exist',
                    ]),
                );
            });
        });
    });

    describe('POST /products/bulk', () => {
        it('accepts the drafts and reaches the service', async () => {
            const res = await harness.call(
                restocker(),
                'POST',
                '/products/bulk',
                BULK,
            );

            expect(res.status).toBe(201);
            expect(service.addMany).toHaveBeenCalledWith(expect.anything(), {
                newProducts: [
                    { EAN: '4006381333931', name: 'bread', price: 1999 },
                    { name: 'milk', price: 5000 },
                ],
            });
        });

        it('refused the old draft rows: autoGenerateEAN is not a field (regression)', async () => {
            const messages = await validationMessages(
                await harness.call(restocker(), 'POST', '/products/bulk', {
                    newProducts: [
                        {
                            EAN: '4006381333931',
                            name: 'Bread',
                            price: 1999,
                            autoGenerateEAN: false,
                        },
                    ],
                }),
            );

            expect(messages).toEqual([
                'newProducts.0.property autoGenerateEAN should not exist',
            ]);
            expect(service.addMany).not.toHaveBeenCalled();
        });

        it('refused a stale typed EAN left behind by auto-generate (regression)', async () => {
            const res = await harness.call(
                restocker(),
                'POST',
                '/products/bulk',
                { newProducts: [{ EAN: 'abc', name: 'Milk', price: 5000 }] },
            );

            expect(res.status).toBe(400);
            expect(service.addMany).not.toHaveBeenCalled();
        });
    });
});
