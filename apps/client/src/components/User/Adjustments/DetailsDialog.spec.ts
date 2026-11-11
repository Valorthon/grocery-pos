import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { Role, UnitOfMeasure } from '@grocery-pos/contracts';
import DetailsDialog from './DetailsDialog.vue';
import { useAuthStore } from '@/stores/auth';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

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
        await mountDialog({
            id: 'a1',
            description: 'spoilage',
            adjustedBy: 'ada',
            date: 'Nov 5, 2026',
        });
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

const COUNT_ID = '64b0000000000000001a2b3c';

async function mountDialog(
    item: Record<string, unknown>,
    roles: Role[] = [Role.Adjuster],
) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = { userId: 'u', username: 'u', roles };
    app = createApp(DetailsDialog, { item: { id: 'a1', ...item } });
    app.use(pinia);
    app.mount(host);
    await flush();
    return host;
}

const text = (testid: string) =>
    document.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim();

function lines(n: number) {
    api.get.mockResolvedValue({ data: { data: [], totalItems: n } });
}

async function searchFor(term: string) {
    const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Search name or barcode"]',
    )!;
    expect(input.placeholder).toBe('Search name or barcode');
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

describe('Adjustment details summary (#260)', () => {
    it('heads with the description and the line count, plural', async () => {
        lines(3);
        await mountDialog({
            description: 'Damaged goods',
            adjustedBy: 'ada',
            date: 'Nov 6, 2026, 7:55 PM',
        });
        expect(text('details-heading')).toBe('Damaged goods');
        expect(text('details-line-count')).toBe('3 lines');
        expect(text('details-meta')).toContain('ada');
        expect(text('details-meta')).toContain('Nov 6, 2026, 7:55 PM');
    });

    it('says "1 line" for one line', async () => {
        lines(1);
        await mountDialog({ description: 'x', date: 'd' });
        expect(text('details-line-count')).toBe('1 line');
    });

    it('leaves an unknown adjuster out instead of a placeholder', async () => {
        await mountDialog({ description: 'x', date: 'Nov 6' });
        expect(
            document.querySelectorAll('[data-testid="details-meta"] li'),
        ).toHaveLength(1);
        expect(document.body.textContent).not.toMatch(/N\/A|Unknown/);
    });

    it('keeps the whole adjustment line count while searching', async () => {
        lines(4);
        await mountDialog({ description: 'x', date: 'd' });
        lines(1);
        await searchFor('rice');
        expect(text('details-line-count')).toBe('4 lines');
    });

    it('recovers the line count after a failed first load', async () => {
        api.get.mockRejectedValueOnce(new Error('offline'));
        await mountDialog({ description: 'x', date: 'd' });
        expect(text('details-line-count')).toBeUndefined();
        api.get.mockImplementation((_url: string, { params }) =>
            Promise.resolve({
                data: {
                    data: [],
                    totalItems: (params as { name?: string }).name ? 1 : 5,
                },
            }),
        );
        await searchFor('rice');
        expect(text('details-line-count')).toBe('5 lines');
    });

    it('caps the search box at the product name limit', async () => {
        await mountDialog({ description: 'x' });
        expect(
            document.querySelector<HTMLInputElement>(
                'input[aria-label="Search name or barcode"]',
            )!.maxLength,
        ).toBe(50);
    });

    it('shows a count approval as "Stock count" linked to the count', async () => {
        api.get.mockResolvedValue({
            data: {
                data: [
                    {
                        _id: 'l1',
                        adjustment: 'a1',
                        product: {
                            _id: 'p',
                            name: 'Rice',
                            EAN: '4800000000012',
                        },
                        change: 2,
                        reason: `stock count ${COUNT_ID}`,
                    },
                ],
                totalItems: 1,
            },
        });
        await mountDialog({ description: `stock count ${COUNT_ID}` });
        const link = document.querySelector<HTMLButtonElement>(
            '[data-testid="stock-count-link"]',
        )!;
        expect(link.textContent?.trim()).toBe('Stock count 001A2B3C');
        expect(document.querySelector('tbody')?.textContent).toContain(
            'Stock count 001A2B3C',
        );
        expect(document.body.textContent).not.toContain(COUNT_ID);
        link.click();
        expect(push).toHaveBeenCalledWith({
            name: 'StockCounts',
            query: { source: COUNT_ID },
        });
    });

    it('shows it as plain text to viewers who cannot open Stock counts', async () => {
        await mountDialog({ description: `stock count ${COUNT_ID}` }, []);
        expect(
            document.querySelector('[data-testid="stock-count-link"]'),
        ).toBeNull();
        expect(text('details-heading')).toBe('Stock count 001A2B3C');
    });
});

describe('Adjustment details search (#260)', () => {
    it('sends digits as an EAN prefix and other text as a name, on page 1', async () => {
        await mountDialog({ description: 'x' });
        expect(document.querySelector('form form')).toBeNull();
        await searchFor('4800');
        expect(lastParams()).toEqual({
            page: 1,
            limit: expect.any(Number) as unknown,
            EAN: '4800',
        });
        await searchFor('rice');
        expect(lastParams()).toEqual({
            page: 1,
            limit: expect.any(Number) as unknown,
            name: 'RICE',
        });
    });

    it('Clear empties the box and loads every line', async () => {
        await mountDialog({ description: 'x' });
        await searchFor('rice');
        document
            .querySelector<HTMLButtonElement>('[data-clear-filters]')!
            .click();
        await flush();
        expect(
            document.querySelector<HTMLInputElement>(
                'input[aria-label="Search name or barcode"]',
            )!.value,
        ).toBe('');
        expect(lastParams()).toEqual({
            page: 1,
            limit: expect.any(Number) as unknown,
        });
    });
});
