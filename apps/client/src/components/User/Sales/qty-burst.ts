import { hasValidCheckDigit } from '@grocery-pos/contracts';
import { SCAN_KEY_INTERVAL_MS } from '@/composables/useBarcodeCapture';
import { isBarcode } from './product-search';

/** A scanner burst: a barcode length with a valid check digit (#323). */
export function isScannedCode(code: string): boolean {
    return isBarcode(code) && hasValidCheckDigit(code);
}

/**
 * Keeps a keyboard-wedge scan out of a ticket line's quantity field
 * (#323). Every digit is held back, not typed; when no digit follows
 * within `intervalMs` the held digits are typed into the field as usual
 * (an `input` event fires, as for a keystroke). Enter right after a fast
 * run of digits that forms a valid EAN-13, UPC-A or EAN-8 is a scan:
 * the digits never reach the field and `onScan(code)` runs instead.
 * Anything else (slow typing, a short run, an invalid code, another
 * key, a blur) types the held digits first, so ordinary input is
 * unchanged apart from a short delay.
 */
export function createQtyBurst(
    onScan: (input: HTMLInputElement, code: string) => void,
    intervalMs = SCAN_KEY_INTERVAL_MS,
) {
    let held = '';
    let last = 0;
    let field: HTMLInputElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Types the held digits; true when any were typed. */
    function flush(): boolean {
        if (timer) clearTimeout(timer);
        timer = undefined;
        const el = field;
        const text = held;
        held = '';
        field = null;
        if (!el || !text || el.disabled || !el.isConnected) return false;
        el.setRangeText(
            text,
            el.selectionStart ?? el.value.length,
            el.selectionEnd ?? el.value.length,
            'end',
        );
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    function onKeydown(event: KeyboardEvent) {
        const el = event.target as HTMLInputElement;
        if (field && field !== el) flush();
        if (
            event.isComposing ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey
        ) {
            flush();
            return;
        }
        const now = performance.now();
        const fast = held !== '' && now - last <= intervalMs;
        if (event.key === 'Enter' && fast && isScannedCode(held)) {
            const code = held;
            if (timer) clearTimeout(timer);
            timer = undefined;
            held = '';
            field = null;
            event.preventDefault();
            event.stopImmediatePropagation();
            onScan(el, code);
            return;
        }
        if (/^\d$/.test(event.key) && !event.repeat) {
            if (held && !fast) flush();
            event.preventDefault();
            held += event.key;
            field = el;
            last = now;
            if (timer) clearTimeout(timer);
            timer = setTimeout(flush, intervalMs);
            return;
        }
        // Enter, Escape, Delete, a decimal point…: the held digits come
        // first, then the key does what it always does.
        flush();
    }

    return { onKeydown, flush };
}
