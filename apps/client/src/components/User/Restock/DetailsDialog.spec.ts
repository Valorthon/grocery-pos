import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { UnitOfMeasure } from '@grocery-pos/contracts';
import DetailsDialog from './DetailsDialog.vue';

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
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(DetailsDialog, {
            item: {
                id: 'r1',
                description: 'weekly',
                restockedBy: 'rex',
                totalCost: '₱75.00',
                date: 'Nov 5, 2026',
            },
        });
        app.use(createPinia());
        app.mount(host);
        await flush();
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
