import { onBeforeUnmount, onMounted } from 'vue';
import { isAxiosError } from 'axios';
import {
    ErrorCode,
    type Paginated,
    type ProductView,
} from '@grocery-pos/contracts';
import api from '@/axios';
import { anyModalOpen } from '@/components/ui/modal-stack';
import { isBarcode } from '@/components/User/Sales/product-search';
import { apiErrorCode } from '@/utils/api-error';
import { isTextEntry } from './useRegisterShortcuts';

/**
 * The longest gap between two keystrokes of one scan (issue #214). Hand
 * typing is far slower; Bluetooth wedges can be slow or bursty, so this is
 * generous.
 */
export const SCAN_KEY_INTERVAL_MS = 120;

export interface BarcodeCaptureOptions {
    /** Scans are ignored while this is false (e.g. a locked PO). */
    enabled?: () => boolean;
    /** Override for tests. */
    intervalMs?: number;
}

/** True while the focus is in a field that takes keystrokes itself. */
function typingIn(el: Element | null): boolean {
    return isTextEntry(el) || el instanceof HTMLSelectElement;
}

/**
 * Page-wide keyboard-wedge scanner capture for the draft screens (issue
 * #214): digits typed at scanner speed, then Enter, from anywhere on the
 * page call `onScan(code)` when the code is barcode-shaped (`isBarcode`).
 *
 * Ignored while typing in a text, number or select field, during IME
 * composition, on held-key repeats, with Ctrl/Alt/Meta, and while any
 * modal or drawer is open. A slow keystroke restarts the buffer, so hand
 * typing never counts. Never mount it on the register: the scan box there
 * handles the scanner (`useStickyFocus`).
 */
export function useBarcodeCapture(
    onScan: (code: string) => void,
    options: BarcodeCaptureOptions = {},
) {
    const interval = options.intervalMs ?? SCAN_KEY_INTERVAL_MS;
    let buffer = '';
    let last = 0;

    function reset() {
        buffer = '';
        last = 0;
    }

    function onKeydown(event: KeyboardEvent) {
        if (
            event.repeat ||
            event.isComposing ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey ||
            anyModalOpen.value ||
            typingIn(event.target as Element | null) ||
            typingIn(document.activeElement) ||
            (options.enabled && !options.enabled())
        ) {
            reset();
            return;
        }
        const now = performance.now();
        const fast = buffer !== '' && now - last <= interval;
        if (event.key === 'Enter') {
            const code = fast ? buffer : '';
            reset();
            if (!isBarcode(code)) return;
            event.preventDefault();
            event.stopPropagation();
            onScan(code);
            return;
        }
        if (!/^\d$/.test(event.key)) {
            reset();
            return;
        }
        buffer = fast ? buffer + event.key : event.key;
        last = now;
    }

    onMounted(() => document.addEventListener('keydown', onKeydown, true));
    onBeforeUnmount(() =>
        document.removeEventListener('keydown', onKeydown, true),
    );
    return { reset };
}

/** What a draft screen's add dialog opens with after a scan. */
export interface ScannedLine {
    /** A known active product. */
    product?: ProductView;
    /** An unknown code, for a new product (restock only). */
    EAN?: string;
}

/** What an exact barcode lookup found. */
export type ScanLookup =
    | { kind: 'found'; product: ProductView }
    | { kind: 'archived' }
    | { kind: 'unknown' };

/**
 * Exact `GET /products/:EAN` for the draft screens: archived products are
 * refused by the API ("Product discontinued") and reported as `archived`.
 * Other failures throw.
 */
export async function lookupActiveBarcode(code: string): Promise<ScanLookup> {
    try {
        const { data } = await api.get<ProductView>(
            `/products/${encodeURIComponent(code)}`,
        );
        return { kind: 'found', product: data };
    } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404)
            return { kind: 'unknown' };
        if (apiErrorCode(error) === ErrorCode.VALIDATION_INVALID_INPUT)
            return { kind: 'archived' };
        throw error;
    }
}

/**
 * The one product, active or archived, whose stored barcode is exactly
 * `code`, or null (issue #214). Lists show archived products, so this goes
 * through the list query (prefix, all statuses) and keeps exact matches.
 */
export async function findExactProduct(
    code: string,
): Promise<ProductView | null> {
    const { data } = await api.get<Paginated<ProductView>>('/products', {
        params: { EAN: code, status: 'all', page: 1, limit: 100 },
    });
    const exact = data.data.filter((row) => row.EAN === code);
    return exact.length === 1 ? exact[0] : null;
}

/** The barcode-shaped term of a list search, or null (issue #214). */
export function scannedTerm(...terms: string[]): string | null {
    const filled = terms.map((t) => t.trim()).filter(Boolean);
    return filled.length === 1 && isBarcode(filled[0]) ? filled[0] : null;
}
