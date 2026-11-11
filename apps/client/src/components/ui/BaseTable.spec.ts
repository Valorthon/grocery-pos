import { afterEach, describe, expect, it } from 'vitest';
import { type App, type Component, createApp, h } from 'vue';
import BaseTable from './BaseTable.vue';
import BaseModal from './BaseModal.vue';
import { flush } from '@/testing/form-dom';

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

describe('BaseTable opt-in row click (issue #234)', () => {
    const ITEMS = [
        { id: 'a', name: 'first' },
        { id: 'b', name: 'second' },
    ];
    function mountClickable(rowClick: boolean) {
        const clicks: unknown[] = [];
        const inner: string[] = [];
        const host = mountRender(() =>
            table(
                {
                    headers: [{ title: 'Name', key: 'name' }],
                    items: ITEMS,
                    rowClick,
                    'onClick:row': (row: unknown) => clicks.push(row),
                },
                {
                    'cell-name': ((p: { item: { name: string } }) => [
                        p.item.name,
                        h(
                            'button',
                            { onClick: () => inner.push(p.item.name) },
                            'Open',
                        ),
                        h('a', { href: '#x' }, 'link'),
                        h('input', {}),
                    ]) as () => unknown,
                },
            ),
        );
        const rows = Array.from(
            host.querySelectorAll<HTMLTableRowElement>('tbody tr'),
        );
        return { host, rows, clicks, inner };
    }
    it('keeps the sr-only row hint inside a positioned table wrapper (#252)', () => {
        const { host } = mountClickable(true);
        const hint = host.querySelector('.sr-only')!;
        expect(hint).not.toBeNull();
        const wrapper = host.firstElementChild as HTMLElement;
        expect(wrapper.contains(hint)).toBe(true);
        expect(wrapper.classList.contains('relative')).toBe(true);
    });
    const key = (el: Element, k: string, repeat = false) => {
        const ev = new KeyboardEvent('keydown', {
            key: k,
            bubbles: true,
            cancelable: true,
            repeat,
        });
        el.dispatchEvent(ev);
        return ev;
    };

    it('emits click:row with the row clicked, by its item not its index', () => {
        const { rows, clicks } = mountClickable(true);
        rows[1]!.querySelector('td')!.click();
        expect(clicks).toEqual([ITEMS[1]]);
    });

    it('makes rows focusable with a hint, and Enter/Space activate them', () => {
        const { host, rows, clicks } = mountClickable(true);
        const row = rows[0]!;
        expect(row.tabIndex).toBe(0);
        expect(row.className).toContain('focus-ring');
        expect(row.className).toContain('cursor-pointer');
        const hint = document.getElementById(
            row.getAttribute('aria-describedby')!,
        );
        expect(host.contains(hint)).toBe(true);
        expect(hint?.textContent).toBe('Press Enter to open details');
        const enter = key(row, 'Enter');
        expect(enter.defaultPrevented).toBe(true);
        key(row, ' ');
        key(row, 'Enter', true);
        key(row, 'a');
        expect(clicks).toEqual([ITEMS[0], ITEMS[0]]);
    });

    it('never fires from inner buttons, links or fields', () => {
        const { rows, clicks, inner } = mountClickable(true);
        const row = rows[0]!;
        const button = row.querySelector('button')!;
        button.click();
        row.querySelector('a')!.click();
        row.querySelector('input')!.click();
        key(button, 'Enter');
        key(button, ' ');
        key(row.querySelector('input')!, 'Enter');
        expect(clicks).toEqual([]);
        expect(inner).toEqual(['first']);
    });

    it('leaves rows without the opt-in as before', () => {
        const { host, rows, clicks } = mountClickable(false);
        const row = rows[0]!;
        expect(row.hasAttribute('tabindex')).toBe(false);
        expect(row.hasAttribute('aria-describedby')).toBe(false);
        expect(row.className).not.toContain('cursor-pointer');
        expect(host.querySelector('.sr-only')).toBeNull();
        row.querySelector('td')!.click();
        key(row, 'Enter');
        expect(clicks).toEqual([]);
    });
});

describe('BaseTable column help (#263)', () => {
    const help = [
        { term: 'Open', meaning: 'Still going.' },
        { term: 'Closed', meaning: 'Done.' },
    ];
    const headers = [
        { title: 'Name', key: 'name' },
        { title: 'Status', key: 'status', help },
        { title: 'Total', key: 'total', align: 'right', help: 'Sum.' },
        { title: 'Note', key: 'note', hideBelow: 'md', help: 'Hidden.' },
    ];
    const items = [{ id: '1', name: 'a', status: 'Open', total: 1, note: '' }];
    const buttons = (host: HTMLElement) =>
        Array.from(
            host.querySelectorAll<HTMLButtonElement>('th [data-info-tooltip]'),
        );

    it('adds no ⓘ to a column without help', () => {
        const host = mountTables({ ...TABLE_PROPS });
        expect(buttons(host)).toHaveLength(0);
    });

    it('labels a 44px ⓘ described by its tooltip, listing every term', () => {
        const host = mountTables({ headers, items });
        const [status] = buttons(host);
        expect(status!.getAttribute('aria-label')).toBe('About Status');
        expect(status!.className).toContain('min-h-11');
        expect(status!.className).toContain('min-w-11');
        const tip = document.getElementById(
            status!.getAttribute('aria-describedby')!,
        )!;
        expect(tip.getAttribute('role')).toBe('tooltip');
        expect(
            [...tip.querySelectorAll('dl dt')].map((d) => d.textContent),
        ).toEqual(['Open', 'Closed']);
        expect(tip.className).toContain('normal-case');
    });

    it('puts the ⓘ before the title in a right-aligned column', () => {
        const host = mountTables({ headers, items });
        const th = host.querySelectorAll('th')[2]!;
        const wrap = th.querySelector('[data-column-help]')!;
        expect(
            wrap.firstElementChild?.querySelector('[data-info-tooltip]'),
        ).not.toBeNull();
        expect(wrap.textContent?.trim().endsWith('Total')).toBe(true);
        const status = host.querySelectorAll('th')[1]!;
        expect(status.textContent?.trim().startsWith('Status')).toBe(true);
    });

    it('hides the help with its column under hideBelow', () => {
        const host = mountTables({ headers, items });
        const th = host.querySelectorAll('th')[3]!;
        expect(th.className).toContain('hidden md:table-cell');
        expect(th.querySelector('[data-info-tooltip]')).not.toBeNull();
    });

    it('never opens a row when the ⓘ is clicked', async () => {
        const rows: unknown[] = [];
        const host = mountTables({
            headers,
            items,
            rowClick: true,
            'onClick:row': (row: unknown) => rows.push(row),
        });
        buttons(host)[0]!.click();
        await flush();
        expect(rows).toHaveLength(0);
    });

    it('Escape closes only the tooltip inside a modal', async () => {
        let open = true;
        const onClose = () => (open = false);
        mountRender(() =>
            open
                ? h(
                      BaseModal as Component,
                      {
                          modelValue: true,
                          title: 'Dialog',
                          'onUpdate:modelValue': onClose,
                      },
                      () => table({ headers, items }),
                  )
                : null,
        );
        await flush();
        const button = document.querySelector<HTMLButtonElement>(
            'th [data-info-tooltip]',
        )!;
        const tip = document.getElementById(
            button.getAttribute('aria-describedby')!,
        )!;
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
        expect(open).toBe(true);
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });
});
