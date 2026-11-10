import type { WireShape } from './wire-shape.js';

export const SETTINGS_LIMITS = {
    STORE_NAME: 120,
    BRANCH_NAME: 120,
    ADDRESS: 500,
    CONTACT: 80,
    TIN: 80,
    FOOTER: 1000,
    TIMEZONE: 100,
    TERMINAL: 80,
    REORDER_LEVEL: 1_000_000,
    /** Dashboard/Inventories expiry alert window, whole days (#213). */
    EXPIRY_ALERT_DAYS_MIN: 1,
    EXPIRY_ALERT_DAYS_MAX: 90,
    EXPIRY_ALERT_DAYS_DEFAULT: 7,
} as const;

/** Store identity is presentation data, never an authorization credential. */
export interface StoreIdentity {
    storeName: string;
    branchName: string;
    address: string;
    contactNumber: string;
    tin: string;
    receiptFooter: string;
}
export interface StoreSettings extends StoreIdentity {
    timezone: string;
    currency: string;
    /** Display units, used only as a default when creating new products. */
    defaultReorderLevel: number;
    /** Whole days; batches expiring within it (or expired) are alerted. A legacy row without it reads as 7. */
    expiryAlertDays: number;
    version: number;
}
export type UpdateStoreSettingsRequest = Partial<StoreIdentity> & {
    timezone?: string;
    defaultReorderLevel?: number;
    expiryAlertDays?: number;
    version: number;
};
export const STORE_SETTINGS_SHAPE: WireShape<StoreSettings> = {
    storeName: 'required',
    branchName: 'required',
    address: 'required',
    contactNumber: 'required',
    tin: 'required',
    receiptFooter: 'required',
    timezone: 'required',
    currency: 'required',
    defaultReorderLevel: 'required',
    expiryAlertDays: 'required',
    version: 'required',
};

/** The store-calendar date now (`YYYY-MM-DD`) in the committed store timezone (#215). */
export interface StoreToday {
    today: string;
    timezone: string;
}
export const STORE_TODAY_SHAPE: WireShape<StoreToday> = {
    today: 'required',
    timezone: 'required',
};

/** Identity captured for a receipt/report; not mutable store configuration. */
export interface ReceiptStoreIdentity extends StoreIdentity {
    timezone: string;
    currency: string;
    terminalLabel: string;
}
export function receiptStoreIdentity(
    settings: StoreSettings,
    terminalLabel: string,
): ReceiptStoreIdentity {
    return {
        storeName: settings.storeName,
        branchName: settings.branchName,
        address: settings.address,
        contactNumber: settings.contactNumber,
        tin: settings.tin,
        receiptFooter: settings.receiptFooter,
        timezone: settings.timezone,
        currency: settings.currency,
        terminalLabel,
    };
}

export const RECEIPT_STORE_IDENTITY_SHAPE: WireShape<ReceiptStoreIdentity> = {
    storeName: 'required',
    branchName: 'required',
    address: 'required',
    contactNumber: 'required',
    tin: 'required',
    receiptFooter: 'required',
    timezone: 'required',
    currency: 'required',
    terminalLabel: 'required',
};
