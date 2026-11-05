import { expect, it } from 'vitest';
import {
    receiptStoreIdentity,
    RECEIPT_STORE_IDENTITY_SHAPE,
    STORE_SETTINGS_SHAPE,
    type StoreSettings,
} from './settings.js';
import { wireShapeDiff } from './wire-shape.js';
it('captures only immutable receipt presentation fields, excluding settings concurrency state', () => {
    const settings: StoreSettings = {
        storeName: 'Original',
        branchName: 'Main',
        address: 'Address',
        contactNumber: '123',
        tin: 'TIN',
        receiptFooter: 'Thanks',
        timezone: 'Asia/Manila',
        currency: 'PHP',
        defaultReorderLevel: 10,
        version: 7,
    };
    const receipt = receiptStoreIdentity(settings, 'Lane 2');
    expect(wireShapeDiff(settings, STORE_SETTINGS_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    expect(wireShapeDiff(receipt, RECEIPT_STORE_IDENTITY_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    settings.storeName = 'Changed';
    settings.timezone = 'UTC';
    expect(receipt.storeName).toBe('Original');
    expect(receipt.timezone).toBe('Asia/Manila');
    expect(receipt.terminalLabel).toBe('Lane 2');
    expect(receipt).not.toHaveProperty('version');
    expect(receipt).not.toHaveProperty('defaultReorderLevel');
});
