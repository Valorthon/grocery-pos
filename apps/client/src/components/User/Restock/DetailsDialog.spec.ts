import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { Role, UnitOfMeasure } from '@grocery-pos/contracts';
import DetailsDialog from './DetailsDialog.vue';
import { useAuthStore } from '@/stores/auth';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let app: App | null = null;

async function flush() {
    for (let i = 0; i < 3; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 3; i++) await nextTick();
}

beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockReset().mockResolvedValue({
        data: {
            data: [
                {
                    _id: 'line1',
                    restock: 'r1',
                    product: {
                        _id: 'p1',
                        name: 'Rice',
                        EAN: '4800000000012',
                        unit: UnitOfMeasure.KG,
                    },
                    unit: UnitOfMeasure.KG,
                    quantity: 1500,
                    unitCost: 5_000,
                },
            ],
            totalItems: 1,
        },
    });
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('Restock details dialog (#243)', () => {
    it('shows each line as a product cell: name with its EAN below', async () => {
        await mountDialog({
            id: 'r1',
            description: 'weekly',
            restockedBy: 'rex',
            totalCost: '₱75.00',
            date: 'Nov 5, 2026',
        });
        expect(api.get).toHaveBeenCalledWith('/restocks/details/r1', {
            params: expect.objectContaining({ page: 1 }) as unknown,
        });
        const cell = document.querySelector('tbody tr > *')!;
        expect(cell.textContent).toContain('Rice');
        expect(cell.querySelector('[data-testid="row-ean"]')?.textContent).toBe(
            '4800000000012',
        );
        expect(document.querySelector('thead')?.textContent).toContain(
            'Product',
        );
        expect(document.querySelector('tbody')?.textContent).toContain(
            '1.500 kg',
        );
    });
});

const PO = '64b000000000000000abcdef';

async function mountDialog(item: Record<string, unknown>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = {
        userId: 'u',
        username: 'u',
        roles: [Role.Restocker],
    };
    app = createApp(DetailsDialog, {
        item: { id: 'r1', totalCost: '₱254.00', ...item },
    });
    app.use(pinia);
    app.mount(host);
    await flush();
    return host;
}

const text = (testid: string) =>
    document.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim();

describe('Restock details summary (#260)', () => {
    it('heads with the supplier and total, then invoice · PO · restocker · date', async () => {
        await mountDialog({
            supplier: 'E2E Supplier 28014',
            invoiceNumber: 'DR-7',
            purchaseOrder: PO,
            description: 'Purchase order PO-00ABCDEF',
            restockedBy: 'rex',
            date: 'Nov 6, 2026, 7:55 PM',
        });
        expect(text('details-heading')).toBe('E2E Supplier 28014');
        expect(text('details-total')).toBe('₱254.00');
        const items = Array.from(
            document.querySelectorAll('[data-testid="details-meta"] li'),
        ).map((li) => li.textContent?.trim());
        expect(items).toEqual([
            'DR-7',
            'PO-00ABCDEF',
            'rex',
            'Nov 6, 2026, 7:55 PM',
        ]);
        expect(
            document.querySelector(
                '[data-testid="restock-purchase-order"] [data-testid="purchase-order-link"]',
            ),
        ).not.toBeNull();
        // The default PO description repeats the meta line: hidden.
        expect(
            document.querySelector('[data-testid="details-description"]'),
        ).toBeNull();
    });

    it('leaves empty values out, never a placeholder', async () => {
        await mountDialog({
            supplier: 'Dairy',
            description: '',
            date: 'Nov 6',
        });
        expect(
            document.querySelectorAll('[data-testid="details-meta"] li'),
        ).toHaveLength(1);
        expect(
            document.querySelector('[data-testid="restock-purchase-order"]'),
        ).toBeNull();
        expect(document.body.textContent).not.toMatch(
            /—|N\/A|Unknown|No invoice/,
        );
    });

    it('shows a description of its own', async () => {
        await mountDialog({
            supplier: 'Dairy',
            purchaseOrder: PO,
            description: 'Short delivery',
        });
        expect(text('details-description')).toBe('Short delivery');
    });

    it('shows a legacy receipt without supplier as muted "Unknown supplier"', async () => {
        await mountDialog({ description: 'Old receipt' });
        const heading = document.querySelector(
            '[data-testid="details-heading"]',
        )!;
        expect(heading.textContent?.trim()).toBe('Unknown supplier');
        expect(heading.className).toContain('text-muted');
        expect(text('details-description')).toBe('Old receipt');
    });
});

describe('Restock details search (#260)', () => {
    async function searchFor(term: string) {
        const input = document.querySelector<HTMLInputElement>(
            'input[aria-label="Search name or barcode"]',
        )!;
        input.value = term;
        input.dispatchEvent(new Event('input'));
        input.form!.requestSubmit();
        await flush();
    }
    const lastParams = () =>
        (
            api.get.mock.calls[api.get.mock.calls.length - 1] as [
                string,
                { params: object },
            ]
        )[1].params;

    it('routes digits to EAN and text to name, and Clear resets', async () => {
        await mountDialog({ supplier: 'Dairy' });
        // No visible label above the box: only an aria-label and a placeholder.
        for (const label of document.querySelectorAll('form label'))
            expect(label.textContent?.trim()).toBe('');
        await searchFor('48000');
        expect(lastParams()).toEqual({
            page: 1,
            limit: expect.any(Number) as unknown,
            EAN: '48000',
        });
        await searchFor('fresh milk');
        expect(lastParams()).toEqual({
            page: 1,
            limit: expect.any(Number) as unknown,
            name: 'FRESH MILK',
        });
        document
            .querySelector<HTMLButtonElement>('[data-clear-filters]')!
            .click();
        await flush();
        expect(lastParams()).toEqual({
            page: 1,
            limit: expect.any(Number) as unknown,
        });
    });
});
