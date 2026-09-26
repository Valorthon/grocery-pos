/**
 * Restock and inventory-list request validation over real HTTP (issue #14):
 * the global ValidationPipe as main.ts configures it (whitelist,
 * forbidNonWhitelisted), with the services faked. What is under test is
 * which bodies and queries reach the service.
 */
import { Role } from '../../auth/types';
import { ErrorCode } from '../../common/errors';
import {
    AccessHarness,
    bootAccessHarness,
    caller,
} from '../../common/testing/access-harness';
import { RestockController } from './restock.controller';
import { RestockService } from './restock.service';
import { InventoryController } from '../inventory/inventory.controller';
import { InventoryService } from '../inventory/inventory.service';
import { BARCODE_MESSAGES } from '@grocery-pos/contracts';

const PRODUCT = '507f1f77bcf86cd799439011';
const NEW_PRODUCT = { name: 'bread', price: 1999 };
const ONE_OF =
    'Exactly one of the following must be provided: newProduct, product';

describe('Restock and inventory validation (e2e, issue #14)', () => {
    let harness: AccessHarness;

    const restockService = {
        restock: jest.fn().mockResolvedValue(undefined),
    };
    const inventoryService = {
        getAll: jest.fn().mockResolvedValue({ data: [], totalItems: 0 }),
    };

    beforeAll(async () => {
        harness = await bootAccessHarness(
            [RestockController, InventoryController],
            [
                { provide: RestockService, useValue: restockService },
                { provide: InventoryService, useValue: inventoryService },
            ],
        );
    });

    afterAll(async () => {
        await harness.close();
    });

    beforeEach(() => {
        restockService.restock.mockClear();
        inventoryService.getAll.mockClear();
    });

    function restock(line: Record<string, unknown>) {
        return harness.call(caller(Role.Restocker), 'POST', '/restocks', {
            description: 'delivery',
            restockDetails: [{ quantity: 3, unitCost: 1000, ...line }],
        });
    }

    async function refused(res: Response): Promise<string[]> {
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
            error: string;
            details: { messages: string[] };
        };
        expect(body.error).toBe(ErrorCode.VALIDATION_INVALID_INPUT);
        expect(restockService.restock).not.toHaveBeenCalled();
        return body.details.messages;
    }

    it('accepts a line with just an existing product', async () => {
        const res = await restock({ product: PRODUCT });

        expect(res.status).toBe(201);
        expect(restockService.restock).toHaveBeenCalledTimes(1);
    });

    it('accepts a line with just a new product and a valid barcode', async () => {
        const res = await restock({
            newProduct: { ...NEW_PRODUCT, EAN: '036000291452' },
        });

        expect(res.status).toBe(201);
    });

    it('refuses a line with both newProduct and product', async () => {
        const messages = await refused(
            await restock({ product: PRODUCT, newProduct: NEW_PRODUCT }),
        );

        expect(messages).toEqual([`restockDetails.0.${ONE_OF}`]);
    });

    it('refuses a line with neither', async () => {
        const messages = await refused(await restock({}));

        expect(messages).toEqual([`restockDetails.0.${ONE_OF}`]);
    });

    it('refuses a `dummy` property', async () => {
        const messages = await refused(
            await restock({ product: PRODUCT, dummy: { any: 'payload' } }),
        );

        expect(messages).toEqual([
            'restockDetails.0.property dummy should not exist',
        ]);
    });

    it.each([
        ['letters', 'abc', BARCODE_MESSAGES.FORMAT],
        ['a bad check digit', '4006381333932', BARCODE_MESSAGES.CHECK_DIGIT],
        ['the generated range', '2000000000015', BARCODE_MESSAGES.RESERVED],
    ])('refuses a new product barcode with %s', async (_l, EAN, message) => {
        const messages = await refused(
            await restock({ newProduct: { ...NEW_PRODUCT, EAN } }),
        );

        expect(messages).toEqual([`restockDetails.0.newProduct.${message}`]);
    });

    it('accepts a ₱0 unit cost and passes it on as 0 (#85)', async () => {
        const res = await restock({ product: PRODUCT, unitCost: 0 });

        expect(res.status).toBe(201);
        expect(restockService.restock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                restockDetails: [
                    expect.objectContaining({ product: PRODUCT, unitCost: 0 }),
                ],
            }),
        );
    });

    it('still refuses a negative unit cost (#85)', async () => {
        const messages = await refused(
            await restock({ product: PRODUCT, unitCost: -1 }),
        );

        expect(messages).toEqual([
            'restockDetails.0.unitCost must not be less than 0',
        ]);
    });

    it('lists out-of-stock rows for maxStock=0', async () => {
        const res = await harness.call(
            caller(Role.Restocker),
            'GET',
            '/inventories?page=1&limit=5&maxStock=0',
        );

        expect(res.status).toBe(200);
        expect(inventoryService.getAll).toHaveBeenCalledWith(
            expect.objectContaining({ maxStock: 0 }),
        );
    });

    it('refuses a negative maxStock', async () => {
        const res = await harness.call(
            caller(Role.Restocker),
            'GET',
            '/inventories?page=1&limit=5&maxStock=-1',
        );

        expect(res.status).toBe(400);
        expect(inventoryService.getAll).not.toHaveBeenCalled();
    });

    it('lowercases the name the inventory screen sends upper-cased', async () => {
        await harness.call(
            caller(Role.Restocker),
            'GET',
            '/inventories?page=1&limit=5&name=MILK',
        );

        expect(inventoryService.getAll).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'milk' }),
        );
    });
});
