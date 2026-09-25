import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h } from 'vue';
import { CASH_DENOMINATIONS } from '@grocery-pos/contracts';
import DenominationIcon from './DenominationIcon.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('DenominationIcon', () => {
    it.each(CASH_DENOMINATIONS.map((d) => d.id))(
        'has an image for the contracts denomination %s',
        (id) => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            app = createApp({ render: () => h(DenominationIcon, { id }) });
            app.mount(host);

            expect(host.querySelector('img')?.getAttribute('src')).toBeTruthy();
        },
    );
});
