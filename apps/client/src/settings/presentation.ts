import { readonly, shallowRef, ref } from 'vue';
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
/** The saved label itself, '' while none is saved ("Not set", #502). */
export const savedTerminalLabel = readonly(savedTerminal);
const GIB = 1024 ** 3;
/**
 * Older Chromium caps a Guest/Incognito (in-memory) profile's quota at a
 * fraction of RAM, a few hundred MB to about 2 GiB, while a normal profile
 * gets about 60% of the disk (tens to hundreds of GiB). Below this the
 * window is most likely Guest/Incognito (#502, #532).
 */
export const EPHEMERAL_QUOTA_BYTES = 4 * GIB;
/**
 * Newer Chromium ("predictable reported storage quota", default from about
 * M147) reports a normal profile's quota as usage + exactly 10 GiB, so the
 * RAM cap above no longer shows (this is why #502's rule missed a real
 * Guest window, #532). Reports put Guest/Incognito a little lower, about
 * usage + 9 GiB, so headroom in [8, 10) GiB counts as ephemeral too.
 */
export const PREDICTABLE_HEADROOM_BYTES = 10 * GIB;
export const EPHEMERAL_HEADROOM_MIN_BYTES = 8 * GIB;
/**
 * Best-effort guess that this is a Guest/Incognito window (#502, #532).
 * True when the reported quota is under `EPHEMERAL_QUOTA_BYTES` or, where
 * `performance.memory` exists, under twice the JS heap limit (old RAM-based
 * caps); or when quota - usage is in [8, 10) GiB (new predictable quota).
 * A normal profile (huge disk quota, or exactly usage + 10 GiB) is false,
 * and so is no estimate. Chromium may hide the difference entirely in a
 * future release; the warning then simply doesn't show.
 */
export async function looksEphemeralBrowser(
    storage: Pick<StorageManager, 'estimate'> | undefined = typeof navigator ===
    'undefined'
        ? undefined
        : navigator.storage,
    heapLimit: number | undefined = (
        globalThis.performance as
            | (Performance & { memory?: { jsHeapSizeLimit?: number } })
            | undefined
    )?.memory?.jsHeapSizeLimit,
): Promise<boolean> {
    if (!storage || typeof storage.estimate !== 'function') return false;
    try {
        const estimate = await storage.estimate();
        const quota = estimate?.quota;
        if (typeof quota !== 'number' || quota <= 0) return false;
        const usage =
            typeof estimate.usage === 'number' && estimate.usage > 0
                ? estimate.usage
                : 0;
        const headroom = quota - usage;
        if (
            headroom >= EPHEMERAL_HEADROOM_MIN_BYTES &&
            headroom < PREDICTABLE_HEADROOM_BYTES
        )
            return true;
        if (quota < EPHEMERAL_QUOTA_BYTES) return true;
        return typeof heapLimit === 'number' && heapLimit > 0
            ? quota < 2 * heapLimit && headroom < EPHEMERAL_HEADROOM_MIN_BYTES
            : false;
    } catch {
        return false;
    }
}
/** Whether this browser has a saved label, apart from the default (#399). */
export function hasSavedTerminalLabel(): boolean {
    return savedTerminal.value !== '';
}
/** Re-read the saved label, e.g. after another tab saved it (#399). */
export function refreshSavedTerminalLabel(): void {
    savedTerminal.value = readSavedTerminal();
    terminalLabel.value = savedTerminal.value || DEFAULT_TERMINAL;
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
