import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { UnitOfMeasure } from '@grocery-pos/contracts';
import DetailsDialog from './DetailsDialog.vue';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

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
                    adjustment: 'a1',
                    product: {
                        _id: 'p1',
                        name: 'Rice',
                        EAN: '4800000000012',
                        unit: UnitOfMeasure.KG,
                    },
                    change: -1500,
                    reason: 'spoiled',
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

describe('Adjustment details dialog (#243)', () => {
    it('shows each line as a product cell: name with its EAN below', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(DetailsDialog, {
            item: {
                id: 'a1',
                description: 'spoilage',
                adjustedBy: 'ada',
                date: 'Nov 5, 2026',
            },
        });
        app.use(createPinia());
        app.mount(host);
        await flush();
        expect(api.get).toHaveBeenCalledWith('/adjustments/details/a1', {
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
            '-1.500 kg',
        );
    });
});
