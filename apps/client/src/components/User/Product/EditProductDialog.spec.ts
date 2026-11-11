import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import { flush } from '@/testing/form-dom';
import type { ProductView } from '@grocery-pos/contracts';
import { INVENTORY_HELP } from '@/components/User/Inventory/inventory-help';
import EditProductDialog from './EditProductDialog.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

let app: App | null = null;
const isOpen = ref(false);

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount() {
    api.get.mockResolvedValue({ data: { data: [], total: 0 } });
    isOpen.value = false;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const product = {
        _id: 'p1',
        EAN: '4006381333931',
        name: 'Rice',
        price: 5000,
        unit: 'PIECE',
    } as unknown as ProductView;
    app = createApp({
        render: () =>
            h(EditProductDialog, {
                modelValue: isOpen.value,
                'onUpdate:modelValue': (v: boolean) => (isOpen.value = v),
                product,
            }),
    });
    app.use(createPinia());
    app.mount(host);
    isOpen.value = true;
    await flush();
}

function note(name: string) {
    const button = document.querySelector<HTMLButtonElement>(
        `[data-info-tooltip][aria-label="${name}"]`,
    )!;
    const tip = document.getElementById(
        button.getAttribute('aria-describedby')!,
    )!;
    return { button, tip };
}

function labelled(text: string) {
    const label = [...document.querySelectorAll('label')].find((l) =>
        l.textContent?.trim().startsWith(text),
    )!;
    return { label, input: document.getElementById(label.htmlFor)! };
}

describe('EditProductDialog help notes (#273)', () => {
    it('reorder fields carry the shared notes after their labels', async () => {
        await mount();
        const level = note('About low stock at');
        const qty = note('About restock amount');
        expect(level.tip.textContent?.trim()).toBe(INVENTORY_HELP.reorderLevel);
        expect(qty.tip.textContent?.trim()).toBe(
            INVENTORY_HELP.reorderQuantity,
        );
        const { label } = labelled('Low stock at');
        expect(
            label.compareDocumentPosition(level.button) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(label.contains(level.button)).toBe(false);
        expect(level.button.parentElement!.classList).toContain('-my-3');
    });

    it('the label is tied to its input; the note does not focus it', async () => {
        await mount();
        const { label, input } = labelled('Restock amount');
        expect(input.tagName).toBe('INPUT');
        note('About restock amount').button.click();
        await flush();
        expect(document.activeElement).not.toBe(input);
        // jsdom doesn't run label activation; the for/id tie is what does.
        expect(label.htmlFor).toBe(input.id);
        expect(input.getAttribute('inputmode')).toBe('decimal');
    });

    it('Escape closes only the note, not the dialog', async () => {
        await mount();
        const { button, tip } = note('About low stock at');
        button.focus();
        await flush();
        expect(tip.classList.contains('hidden')).toBe(false);
        button.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            }),
        );
        await flush();
        expect(tip.classList.contains('hidden')).toBe(true);
        expect(isOpen.value).toBe(true);
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });
});
