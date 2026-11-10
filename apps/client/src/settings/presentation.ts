import { shallowRef, ref } from 'vue';
import {
    DEFAULT_TERMINAL,
    SETTINGS_LIMITS,
    type StoreSettings,
} from '@grocery-pos/contracts';
export const initialSettings: StoreSettings = {
    storeName: 'Grocery POS',
    branchName: '',
    address: '',
    contactNumber: '',
    tin: '',
    receiptFooter: 'Thank you for shopping!',
    timezone: 'Asia/Manila',
    currency: 'PHP',
    defaultReorderLevel: 10,
    expiryAlertDays: SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_DEFAULT,
    version: 0,
};
export const storePresentation = shallowRef<StoreSettings>({
    ...initialSettings,
});
const TERMINAL_KEY = 'grocery_pos_terminal_label_v1';
function readTerminal(): string {
    try {
        return (
            localStorage
                .getItem(TERMINAL_KEY)
                ?.trim()
                .slice(0, SETTINGS_LIMITS.TERMINAL) || DEFAULT_TERMINAL
        );
    } catch {
        return DEFAULT_TERMINAL;
    }
}
export const terminalLabel = ref(readTerminal());
export function saveTerminalLabel(value: string): boolean {
    const label = value.trim();
    if (!label || label.length > SETTINGS_LIMITS.TERMINAL) return false;
    try {
        localStorage.setItem(TERMINAL_KEY, label);
        terminalLabel.value = label;
        return true;
    } catch {
        return false;
    }
}
export function validSettings(value: unknown): value is StoreSettings {
    if (!value || typeof value !== 'object') return false;
    const row = value as Record<string, unknown>;
    const fields = [
        'storeName',
        'branchName',
        'address',
        'contactNumber',
        'tin',
        'receiptFooter',
        'timezone',
    ] as const;
    if (
        !fields.every(
            (key) => typeof row[key] === 'string' && row[key].length <= 1000,
        ) ||
        row.currency !== 'PHP' ||
        !Number.isSafeInteger(row.version) ||
        Number(row.version) < 0 ||
        !Number.isInteger(row.defaultReorderLevel) ||
        Number(row.defaultReorderLevel) < 0 ||
        Number(row.defaultReorderLevel) > SETTINGS_LIMITS.REORDER_LEVEL ||
        !validExpiryAlertDays(row.expiryAlertDays)
    )
        return false;
    try {
        new Intl.DateTimeFormat('en', {
            timeZone: row.timezone as string,
        }).format();
        return true;
    } catch {
        return false;
    }
}
/** Whole days, as the API's settings DTO accepts (#213). */
export function validExpiryAlertDays(value: unknown): value is number {
    return (
        Number.isInteger(value) &&
        Number(value) >= SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_MIN &&
        Number(value) <= SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_MAX
    );
}
