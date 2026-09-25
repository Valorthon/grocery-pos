import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { SEARCH_DEBOUNCE_MS } from '@/composables/useProductMatches';
import {
    click,
    field,
    fieldError,
    flush,
    pickFirstMatch,
    type,
} from '@/testing/form-dom';
import AddDialog from './AddDialog.vue';
import type { AddForm } from './dto';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const MILK = {
    EAN: '4800361002516',
    name: 'BEAR BRAND MILK',
    product: '64b000000000000000000001',
};

let app: App | null = null;
let added: AddForm[];
let updated: AddForm[];

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.get.mockReset();
    api.get.mockResolvedValue({ data: [MILK] });
    added = [];
    updated = [];
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

async function open(item?: AddForm) {
    const isOpen = ref(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(AddDialog, {
                modelValue: isOpen.value,
                'onUpdate:modelValue': (v: boolean) => (isOpen.value = v),
                item,
                onAdd: (p: AddForm) => added.push(p),
                onUpdate: (p: AddForm) => updated.push(p),
            }),
    });
    app.mount(host);
    isOpen.value = true;
    await flush();
    return isOpen;
}

async function searchAndPick(text: string) {
    await type('Search Product', text);
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();
    await pickFirstMatch();
}

describe('Adjustments AddDialog (#17)', () => {
    it('rejects typed text that was never picked from the matches', async () => {
        await open();
        await type('Search Product', 'bear');
        await type('Change', '3');
        await type('Reason', 'recount');
        await click('Adjust');
        expect(added).toEqual([]);
        expect(fieldError('Search Product')).toBe(
            'Pick a product from the matches',
        );
    });

    it('rejects a blank change and a zero change', async () => {
        await open();
        await searchAndPick('bear');
        await type('Reason', 'recount');
        await type('Change', '');
        await click('Adjust');
        expect(fieldError('Change')).toBe('This field is required');
        await type('Change', '0');
        await click('Adjust');
        expect(fieldError('Change')).toBe('Must not be 0');
        expect(added).toEqual([]);
    });

    it('adds a picked product with its id, EAN and a negative change', async () => {
        const isOpen = await open();
        await searchAndPick('bear');
        expect(field('Search Product').value).toBe(MILK.EAN);
        expect(document.body.textContent).toContain('Selected:');
        await type('Change', '-2');
        await type('Reason', ' expired ');
        await click('Adjust');
        expect(added).toEqual([
            {
                EAN: MILK.EAN,
                name: MILK.name,
                product: MILK.product,
                change: -2,
                reason: ' expired ',
            },
        ]);
        expect(isOpen.value).toBe(false);
    });

    it('drops the pick once the search text is edited', async () => {
        await open();
        await searchAndPick('bear');
        await type('Search Product', 'bea');
        await type('Change', '1');
        await type('Reason', 'recount');
        await click('Adjust');
        expect(added).toEqual([]);
        expect(document.body.textContent).not.toContain('Selected:');
    });

    it('keeps an edited line picked', async () => {
        await open({
            EAN: MILK.EAN,
            name: MILK.name,
            product: MILK.product,
            change: 4,
            reason: 'recount',
        });
        expect(document.body.textContent).toContain('Selected:');
        await click('Update Adjustment');
        expect(updated).toHaveLength(1);
        expect(updated[0].product).toBe(MILK.product);
    });

    it('recovers from a failed search', async () => {
        api.get.mockRejectedValue(new Error('Network Error'));
        await open();
        await type('Search Product', 'bear');
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
        await flush();
        expect(fieldError('Search Product')).toBe(
            'Could not search products. Try again.',
        );
        expect(document.body.querySelector('.animate-spin')).toBeNull();
        expect(document.body.textContent).not.toContain('No matching');
    });

    it('passes the contracts reason limit to the textarea', async () => {
        await open();
        expect(field('Reason').getAttribute('maxlength')).toBe('100');
    });
});
