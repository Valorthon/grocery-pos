import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, type App } from 'vue';
import { AxiosError, AxiosHeaders } from 'axios';
import { ErrorCode } from '@grocery-pos/contracts';
import { wedgeScan } from '@/testing/scanner';
import {
    findExactProduct,
    lookupActiveBarcode,
    scannedTerm,
    SCAN_KEY_INTERVAL_MS,
    useBarcodeCapture,
} from './useBarcodeCapture';
import { pushModal, removeModal } from '@/components/ui/modal-stack';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

let app: App | undefined;
let enabled = true;
const onScan = vi.fn();
function mount(html = '') {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(
        defineComponent({
            setup() {
                useBarcodeCapture(onScan, { enabled: () => enabled });
                return () => h('div', { innerHTML: html });
            },
        }),
    );
    app.mount(host);
}
afterEach(() => {
    app?.unmount();
    app = undefined;
    enabled = true;
    onScan.mockReset();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

function failure(status: number, error: ErrorCode) {
    return new AxiosError('x', String(status), undefined, undefined, {
        status,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { statusCode: status, error, message: 'x' },
    });
}

describe('useBarcodeCapture (#214)', () => {
    it('reports a scanner-speed barcode from anywhere on the page', () => {
        mount('<button id="b">x</button>');
        document.getElementById('b')!.focus();
        const enter = wedgeScan('4800000000017');
        expect(onScan).toHaveBeenCalledWith('4800000000017');
        expect(enter.defaultPrevented).toBe(true);
        wedgeScan('12345670');
        expect(onScan).toHaveBeenLastCalledWith('12345670');
    });

    it('ignores slow typing, non-barcode lengths and other keys', () => {
        mount();
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(
            () => (now += SCAN_KEY_INTERVAL_MS + 50),
        );
        const enter = wedgeScan('4800000000017');
        expect(enter.defaultPrevented).toBe(false);
        vi.restoreAllMocks();
        wedgeScan('12345');
        wedgeScan('48000a0000017');
        expect(onScan).not.toHaveBeenCalled();
    });

    it('ignores text, number and select fields, and IME composition', () => {
        mount(
            '<input id="t"><input id="n" type="number"><select id="s"><option>a</option></select>',
        );
        for (const id of ['t', 'n', 's']) {
            const el = document.getElementById(id)!;
            el.focus();
            wedgeScan('4800000000017', el);
        }
        (document.activeElement as HTMLElement).blur();
        for (const key of '4800000000017')
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key, isComposing: true }),
            );
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(onScan).not.toHaveBeenCalled();
    });

    it('ignores held-key repeats, open modals and a disabled page', () => {
        mount();
        for (const key of '4800000000017')
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key, repeat: true }),
            );
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        const entry = {
            root: () => null,
            panel: () => null,
            closable: () => true,
            close: () => {},
            opener: null,
        };
        pushModal(entry);
        wedgeScan('4800000000017');
        removeModal(entry);
        enabled = false;
        wedgeScan('4800000000017');
        expect(onScan).not.toHaveBeenCalled();
        enabled = true;
        wedgeScan('4800000000017');
        expect(onScan).toHaveBeenCalledTimes(1);
    });

    it('stops listening on unmount', () => {
        mount();
        app!.unmount();
        app = undefined;
        wedgeScan('4800000000017');
        expect(onScan).not.toHaveBeenCalled();
    });
});

describe('barcode lookups (#214)', () => {
    it('scannedTerm takes the one barcode-shaped term', () => {
        expect(scannedTerm(' 4800000000017 ', '')).toBe('4800000000017');
        expect(scannedTerm('', '12345678')).toBe('12345678');
        expect(scannedTerm('milk', '')).toBeNull();
        expect(scannedTerm('milk', '12345678')).toBeNull();
        expect(scannedTerm('1234', '')).toBeNull();
    });

    it('findExactProduct asks for the exact code, archived included', async () => {
        const row = { _id: 'p1', EAN: '123456789012', isActive: false };
        api.get.mockResolvedValueOnce({ data: row });
        await expect(findExactProduct('123456789012')).resolves.toBe(row);
        expect(api.get).toHaveBeenCalledWith('/products/123456789012', {
            params: { includeArchived: true },
        });
        api.get.mockRejectedValueOnce(
            failure(404, ErrorCode.PRODUCT_NOT_FOUND),
        );
        await expect(findExactProduct('12345670')).resolves.toBeNull();
        api.get.mockRejectedValueOnce(failure(500, ErrorCode.INTERNAL_ERROR));
        await expect(findExactProduct('12345670')).rejects.toBeTruthy();
    });

    it('lookupActiveBarcode tells found, archived and unknown apart', async () => {
        api.get.mockResolvedValueOnce({ data: { _id: 'p1' } });
        await expect(lookupActiveBarcode('12345670')).resolves.toEqual({
            kind: 'found',
            product: { _id: 'p1' },
        });
        api.get.mockRejectedValueOnce(
            failure(400, ErrorCode.VALIDATION_INVALID_INPUT),
        );
        await expect(lookupActiveBarcode('12345670')).resolves.toEqual({
            kind: 'archived',
        });
        api.get.mockRejectedValueOnce(
            failure(404, ErrorCode.PRODUCT_NOT_FOUND),
        );
        await expect(lookupActiveBarcode('12345670')).resolves.toEqual({
            kind: 'unknown',
        });
        api.get.mockRejectedValueOnce(failure(500, ErrorCode.INTERNAL_ERROR));
        await expect(lookupActiveBarcode('12345670')).rejects.toBeTruthy();
    });
});
