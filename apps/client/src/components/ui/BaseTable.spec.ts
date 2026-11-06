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
const table = () => h(BaseTable as Component, TABLE_PROPS);

describe('BaseTable pager (issue #142)', () => {
    it('ties "Rows per page" to its select, with a unique id per table', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp({ render: () => [table(), table()] });
        app.mount(host);
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
