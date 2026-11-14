import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type ClientSession } from 'mongoose';
import { InventoryService } from './inventory.service';
import { Inventory } from './inventory.schema';
import { ProductService } from '../../product/product.service';
import { InventoryBatchService } from '../batch/batch.service';
import {
    StockMovementService,
    type MovementContext,
} from '../../stock-movement/stock-movement.service';
import { ReportsService } from '../../reports/reports.service';
import { Sales } from '../../sales/sales.schema';
import { SettingsService } from '../../settings/settings.service';
import {
    batchesMock,
    ledgerMock,
    settingsMock,
} from '../../common/testing/business-collaborators';
import { StockMovementSource, StockMovementType } from '@grocery-pos/contracts';

it.each([
    ['batch', InventoryBatchService],
    ['ledger', StockMovementService],
] as const)(
    'refuses to compile inventory without the mandatory %s provider',
    async (_name, missing) => {
        const integrity = [InventoryBatchService, StockMovementService]
            .filter((provider) => provider !== missing)
            .map((provide) => ({ provide, useValue: {} }));
        await expect(
            Test.createTestingModule({
                providers: [
                    InventoryService,
                    { provide: getModelToken(Inventory.name), useValue: {} },
                    { provide: ProductService, useValue: {} },
                    ...integrity,
                ],
            }).compile(),
        ).rejects.toThrow(missing.name);
    },
);

it('refuses to compile reports without committed settings', async () => {
    await expect(
        Test.createTestingModule({
            providers: [
                ReportsService,
                {
                    provide: TypedConfigService,
                    useValue: { get: () => 'Asia/Manila' },
                },
                { provide: getModelToken(Sales.name), useValue: {} },
            ],
        }).compile(),
    ).rejects.toThrow(/argument SettingsService/);
});

it('always delegates ledger and batch integrity work with the transaction session', async () => {
    const batches = batchesMock(),
        ledger = ledgerMock();
    const session = {} as ClientSession;
    const product = '507f1f77bcf86cd799439011';
    const module = await Test.createTestingModule({
        providers: [
            InventoryService,
            {
                provide: getModelToken(Inventory.name),
                useValue: {
                    findOne: () => ({
                        session: () => ({ lean: async () => ({ stock: 0 }) }),
                    }),
                },
            },
            { provide: ProductService, useValue: {} },
            { provide: InventoryBatchService, useValue: batches },
            { provide: StockMovementService, useValue: ledger },
        ],
    }).compile();
    const service = module.get(InventoryService);
    const entries = [{ product, quantity: 2 }];
    const context: MovementContext = {
        type: StockMovementType.RESTOCK,
        refModel: StockMovementSource.RESTOCK,
        refId: product,
        user: product,
    };
    await service.recordMovements(entries, context, session);
    expect(ledger.record).toHaveBeenCalledWith(entries, context, session);
    await service.assertTrackingChange(product, session);
    expect(batches.assertCanChangeTracking).toHaveBeenCalledWith(
        new Types.ObjectId(product),
        session,
    );
    const error = new Error('ledger unavailable');
    ledger.record.mockRejectedValueOnce(error);
    await expect(
        service.recordMovements(entries, context, session),
    ).rejects.toBe(error);
    batches.assertCanChangeTracking.mockRejectedValueOnce(error);
    await expect(service.assertTrackingChange(product, session)).rejects.toBe(
        error,
    );
    await module.close();
});

it('uses and propagates the committed timezone collaborator', async () => {
    const settings = settingsMock({ timezone: 'Pacific/Auckland' });
    const module = await Test.createTestingModule({
        providers: [
            ReportsService,
            { provide: getModelToken(Sales.name), useValue: {} },
            { provide: SettingsService, useValue: settings },
        ],
    }).compile();
    const service = module.get(ReportsService);
    expect((await service.options()).timeZone).toBe('Pacific/Auckland');
    expect(settings.timezone).toHaveBeenCalledTimes(1);
    settings.timezone.mockRejectedValueOnce(new Error('settings unavailable'));
    await expect(service.options()).rejects.toThrow('settings unavailable');
    await module.close();
});
