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
/** The saved label, or '' when none is saved (or storage is unreadable). */
function readSavedTerminal(): string {
    try {
        return (
            localStorage
                .getItem(TERMINAL_KEY)
                ?.trim()
                .slice(0, SETTINGS_LIMITS.TERMINAL) ?? ''
        );
    } catch {
        return '';
    }
}
const savedTerminal = ref(readSavedTerminal());
export const terminalLabel = ref(savedTerminal.value || DEFAULT_TERMINAL);
/** Whether this browser has a saved label, apart from the default (#399). */
export function hasSavedTerminalLabel(): boolean {
    return savedTerminal.value !== '';
}
/**
 * A LAN terminal (#399): a single-pc build opened by any address but
 * localhost (the main PC). It must have a saved label before opening a
 * shift, so its Z-reads never all read "Lane #1". Presentation only: the
 * label has no permission significance and the API checks nothing.
 */
export function isLanTerminal(
    appEnv: string | undefined = import.meta.env.VITE_APP_ENV as
        string | undefined,
    hostname: string = window.location.hostname,
): boolean {
    return appEnv === 'single-pc' && hostname !== 'localhost';
}
export const TERMINAL_LABEL_REQUIRED =
    "Ask an admin to set this terminal's label in Store settings.";
export function saveTerminalLabel(value: string): boolean {
    const label = value.trim();
    if (!label || label.length > SETTINGS_LIMITS.TERMINAL) return false;
    try {
        localStorage.setItem(TERMINAL_KEY, label);
        terminalLabel.value = label;
        savedTerminal.value = label;
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
