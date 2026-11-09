import { afterEach, describe, expect, it } from 'vitest';
import { type App, type Component, createApp, h } from 'vue';
import BaseTable from './BaseTable.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

const TABLE_PROPS: Record<string, unknown> = {
    headers: [{ title: 'Name', key: 'name' }],
    items: [{ id: '1', name: 'a' }],
    itemsLength: 20,
};
const table = (
    props: Record<string, unknown> = TABLE_PROPS,
    slots?: Record<string, () => unknown>,
) => h(BaseTable as Component, props, slots);

/** Mounts one or more tables in a fresh host. */
function mountTables(...tables: Record<string, unknown>[]) {
    return mountRender(() => tables.map((p) => table(p)));
}

function mountRender(render: () => unknown) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render });
    app.mount(host);
    return host;
}

describe('BaseTable pager (issue #142)', () => {
    it('ties "Rows per page" to its select, with a unique id per table', () => {
        const host = mountTables(TABLE_PROPS, TABLE_PROPS);
        const selects = Array.from(host.querySelectorAll('select'));
        expect(selects).toHaveLength(2);
        expect(selects[0]!.id).not.toBe('');
        expect(selects[0]!.id).not.toBe(selects[1]!.id);
        for (const select of selects) {
            expect(
                host
                    .querySelector(`label[for="${select.id}"]`)
                    ?.textContent?.trim(),
            ).toBe('Rows per page:');
        }
    });
});

describe('BaseTable restyle (issue #156)', () => {
    const mount = (props: Record<string, unknown>) => mountTables(props);

    it('makes right-aligned columns tabular, others not', () => {
        const host = mount({
            headers: [
                { title: 'Name', key: 'name' },
                { title: 'Total', key: 'total', align: 'right' },
            ],
            items: [{ id: '1', name: 'a', total: '₱1.00' }],
        });
        const [nameTh, totalTh] = Array.from(host.querySelectorAll('th'));
        const [nameTd, totalTd] = Array.from(host.querySelectorAll('td'));
        for (const el of [totalTh!, totalTd!]) {
            expect(el.className.split(/\s+/)).toEqual(
                expect.arrayContaining(['text-right', 'num']),
            );
        }
        for (const el of [nameTh!, nameTd!]) {
            expect(el.className.split(/\s+/)).not.toContain('num');
        }
    });

    it('shows a default icon in the empty state', () => {
        const host = mount({
            headers: [{ title: 'Name', key: 'name' }],
            items: [],
        });
        expect(
            host.querySelector('[data-testid="table-empty-icon"]'),
        ).not.toBeNull();
        expect(host.textContent).toContain('No data found');
    });

    it('uses no raw palette classes', () => {
        const host = mount(TABLE_PROPS);
        expect(host.innerHTML).not.toMatch(/\b(?:slate|red|emerald)-\d/);
    });

    it('changes the page size through BaseSelect as a number', () => {
        const sizes: number[] = [];
        const host = mount({
            ...TABLE_PROPS,
            'onUpdate:itemsPerPage': (n: number) => sizes.push(n),
        });
        const select = host.querySelector('select')!;
        expect(select.className.split(/\s+/)).toEqual(
            expect.arrayContaining(['rounded-control', 'py-1', 'text-xs']),
        );
        expect(select.className).not.toMatch(/py-2\.5|text-sm/);
        expect(Array.from(select.options).map((o) => o.value)).toEqual([
            '5',
            '10',
            '25',
            '50',
        ]);
        select.value = '25';
        select.dispatchEvent(new Event('change'));
        expect(sizes).toEqual([25]);
    });
});

describe('BaseTable empty slot (issue #169)', () => {
    function mountWithEmpty(items: unknown[]) {
        return mountRender(() =>
            table(
                { headers: [{ title: 'Name', key: 'name' }], items },
                {
                    empty: () => h('p', { 'data-testid': 'custom' }, 'Nothing'),
                },
            ),
        );
    }

    it('renders the empty slot instead of the default empty text', () => {
        const host = mountWithEmpty([]);
        expect(host.querySelector('[data-testid="custom"]')).not.toBeNull();
        expect(
            host.querySelector('[data-testid="table-empty-icon"]'),
        ).toBeNull();
        expect(host.querySelector('td')?.getAttribute('colspan')).toBe('1');
    });

    it('does not render the empty slot when there are rows', () => {
        const host = mountWithEmpty([{ id: '1', name: 'a' }]);
        expect(host.querySelector('[data-testid="custom"]')).toBeNull();
        expect(host.textContent).toContain('a');
    });
});

describe('BaseTable footer slot (issue #170)', () => {
    const footer = () =>
        h('tr', { 'data-testid': 'totals' }, [h('td', 'Total')]);
    function mountWithFooter(props: Record<string, unknown>) {
        return mountRender(() =>
            table(
                { headers: [{ title: 'Name', key: 'name' }], ...props },
                { footer, empty: () => h('p', 'Nothing') },
            ),
        );
    }

    it('renders footer rows in a tfoot beside loaded rows', () => {
        const host = mountWithFooter({ items: [{ id: '1', name: 'a' }] });
        expect(
            host.querySelector('tfoot [data-testid="totals"]'),
        ).not.toBeNull();
    });

    it.each([
        ['empty', { items: [] }],
        ['loading', { items: [{ id: '1', name: 'a' }], loading: true }],
        ['failed', { items: [{ id: '1', name: 'a' }], error: 'Down' }],
    ])('hides the footer while %s', (_, props) => {
        const host = mountWithFooter(props);
        expect(host.querySelector('tfoot')).toBeNull();
    });
});

describe('BaseTable row headers and caption (issue #170)', () => {
    it('renders a rowHeader column as th scope=row and ties the caption', () => {
        const host = mountRender(() =>
            table({
                headers: [
                    { title: 'Group', key: 'name', rowHeader: true },
                    { title: 'Net', key: 'net', align: 'right' },
                ],
                items: [{ id: '1', name: 'Day 1', net: 5 }],
                caption: 'All amounts are pesos.',
            }),
        );
        const cell = host.querySelector('tbody th');
        expect(cell?.getAttribute('scope')).toBe('row');
        expect(cell?.textContent).toContain('Day 1');
        expect(host.querySelectorAll('tbody td')).toHaveLength(1);
        expect(host.querySelector('table > caption')?.textContent).toContain(
            'All amounts are pesos.',
        );
    });

    it('renders no caption by default and leaves footer weight to its rows', () => {
        const host = mountRender(() =>
            table(
                {
                    headers: [{ title: 'Name', key: 'name' }],
                    items: [{ id: '1', name: 'a' }],
                },
                { footer: () => h('tr', [h('td', 'x')]) },
            ),
        );
        expect(host.querySelector('caption')).toBeNull();
        expect(host.querySelector('tfoot')?.className).not.toContain(
            'font-bold',
        );
    });
});

describe('BaseTable narrow columns (issue #208)', () => {
    it('hides a hideBelow column below its breakpoint in head and rows', () => {
        const host = mountTables({
            headers: [
                { title: 'Name', key: 'name' },
                { title: 'Roles', key: 'roles', hideBelow: 'sm' },
                { title: 'Supplier', key: 'supplier', hideBelow: 'lg' },
            ],
            items: [{ id: '1', name: 'a', roles: 'r', supplier: 's' }],
        });
        const [nameTh, rolesTh, supplierTh] = Array.from(
            host.querySelectorAll('th'),
        );
        const [nameTd, rolesTd, supplierTd] = Array.from(
            host.querySelectorAll('td'),
        );
        for (const el of [rolesTh!, rolesTd!]) {
            expect(el.className.split(/\s+/)).toEqual(
                expect.arrayContaining(['hidden', 'sm:table-cell']),
            );
        }
        for (const el of [supplierTh!, supplierTd!]) {
            expect(el.className.split(/\s+/)).toEqual(
                expect.arrayContaining(['hidden', 'lg:table-cell']),
            );
        }
        for (const el of [nameTh!, nameTd!]) {
            expect(el.className.split(/\s+/)).not.toContain('hidden');
        }
    });

    it('hides the column in the loading skeleton too', () => {
        const host = mountTables({
            headers: [
                { title: 'Name', key: 'name' },
                { title: 'Roles', key: 'roles', hideBelow: 'md' },
            ],
            items: [],
            loading: true,
            skeletonRows: 1,
        });
        const cells = Array.from(host.querySelectorAll('tbody td'));
        expect(cells[0]!.className).not.toContain('hidden');
        expect(cells[1]!.className.split(/\s+/)).toEqual(
            expect.arrayContaining(['hidden', 'md:table-cell']),
        );
    });
});
