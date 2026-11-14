import type { StoreSettings } from '@grocery-pos/contracts';
import type { SettingsService } from '../../settings/settings.service';
import type { InventoryBatchService } from '../../inventory-man/batch/batch.service';
import type { StockMovementService } from '../../stock-movement/stock-movement.service';

export const TEST_STORE_SETTINGS: StoreSettings = {
    storeName: 'Grocery POS',
    branchName: '',
    address: '',
    contactNumber: '',
    tin: '',
    receiptFooter: 'Thank you for shopping!',
    timezone: 'Asia/Manila',
    currency: 'PHP',
    defaultReorderLevel: 10,
    expiryAlertDays: 7,
    version: 0,
};

/** Explicit committed-settings collaborator for isolated service harnesses. */
export function settingsMock(
    settings: Partial<StoreSettings> = {},
): jest.Mocked<Pick<SettingsService, 'read' | 'timezone' | 'lockContext'>> {
    const value = { ...TEST_STORE_SETTINGS, ...settings };
    return {
        read: jest
            .fn<
                ReturnType<SettingsService['read']>,
                Parameters<SettingsService['read']>
            >()
            .mockResolvedValue(value),
        timezone: jest
            .fn<
                ReturnType<SettingsService['timezone']>,
                Parameters<SettingsService['timezone']>
            >()
            .mockResolvedValue(value.timezone),
        lockContext: jest
            .fn<
                ReturnType<SettingsService['lockContext']>,
                Parameters<SettingsService['lockContext']>
            >()
            .mockResolvedValue(value),
    } satisfies jest.Mocked<
        Pick<SettingsService, 'read' | 'timezone' | 'lockContext'>
    >;
}

/** All mandatory batch work stays visible to the harness even for untracked fixtures. */
export function batchesMock(): jest.Mocked<
    Pick<
        InventoryBatchService,
        | 'assertCanChangeTracking'
        | 'receive'
        | 'adjust'
        | 'restore'
        | 'consume'
        | 'assertInvariant'
        | 'reconcileOffline'
        | 'expiringCount'
    >
> {
    return {
        assertCanChangeTracking: jest
            .fn<
                ReturnType<InventoryBatchService['assertCanChangeTracking']>,
                Parameters<InventoryBatchService['assertCanChangeTracking']>
            >()
            .mockResolvedValue(undefined),
        receive: jest
            .fn<
                ReturnType<InventoryBatchService['receive']>,
                Parameters<InventoryBatchService['receive']>
            >()
            .mockResolvedValue(undefined),
        adjust: jest
            .fn<
                ReturnType<InventoryBatchService['adjust']>,
                Parameters<InventoryBatchService['adjust']>
            >()
            .mockResolvedValue(undefined),
        restore: jest
            .fn<
                ReturnType<InventoryBatchService['restore']>,
                Parameters<InventoryBatchService['restore']>
            >()
            .mockResolvedValue(undefined),
        consume: jest
            .fn<
                ReturnType<InventoryBatchService['consume']>,
                Parameters<InventoryBatchService['consume']>
            >()
            .mockResolvedValue([]),
        assertInvariant: jest
            .fn<
                ReturnType<InventoryBatchService['assertInvariant']>,
                Parameters<InventoryBatchService['assertInvariant']>
            >()
            .mockResolvedValue(undefined),
        reconcileOffline: jest
            .fn<
                ReturnType<InventoryBatchService['reconcileOffline']>,
                Parameters<InventoryBatchService['reconcileOffline']>
            >()
            .mockResolvedValue(undefined),
        expiringCount: jest
            .fn<
                ReturnType<InventoryBatchService['expiringCount']>,
                Parameters<InventoryBatchService['expiringCount']>
            >()
            .mockResolvedValue(0),
    } satisfies jest.Mocked<
        Pick<
            InventoryBatchService,
            | 'assertCanChangeTracking'
            | 'receive'
            | 'adjust'
            | 'restore'
            | 'consume'
            | 'assertInvariant'
            | 'reconcileOffline'
            | 'expiringCount'
        >
    >;
}

export function ledgerMock(): jest.Mocked<
    Pick<StockMovementService, 'record'>
> {
    return {
        record: jest
            .fn<
                ReturnType<StockMovementService['record']>,
                Parameters<StockMovementService['record']>
            >()
            .mockResolvedValue(undefined),
    } satisfies jest.Mocked<Pick<StockMovementService, 'record'>>;
}
