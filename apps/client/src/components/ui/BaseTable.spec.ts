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
const table = (props: Record<string, unknown> = TABLE_PROPS) =>
    h(BaseTable as Component, props);

/** Mounts one or more tables in a fresh host. */
function mountTables(...tables: Record<string, unknown>[]) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => tables.map((p) => table(p)) });
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

    it('keeps the header sticky inside its own scroller', () => {
        const host = mount({
            headers: [{ title: 'Name', key: 'name' }],
            items: [],
        });
        const th = host.querySelector('th')!;
        expect(th.className.split(/\s+/)).toEqual(
            expect.arrayContaining(['sticky', 'top-0', 'bg-paper']),
        );
        expect(th.closest('.overflow-auto')).not.toBeNull();
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

    it('changes the page size through BaseSelect as a number', async () => {
        const sizes: number[] = [];
        const host = mount({
            ...TABLE_PROPS,
            'onUpdate:itemsPerPage': (n: number) => sizes.push(n),
        });
        const select = host.querySelector('select')!;
        expect(select.className).toContain('rounded-control');
        expect(Array.from(select.options).map((o) => o.value)).toEqual([
            '5',
            '10',
            '25',
            '50',
        ]);
        select.value = '25';
        select.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(sizes).toEqual([25]);
    });
});
