import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp } from 'vue';
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
            const host = mount(id);
            expect(host.querySelector('img')?.getAttribute('src')).toBeTruthy();
        },
    );
});

function mount(id: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(DenominationIcon, { id, class: 'w-14 h-14' });
    app.mount(host);
    return host;
}

describe('DenominationIcon names what it shows (issue #24)', () => {
    it('gives the picture the denomination as its alt text', () => {
        expect(mount('1000').querySelector('img')?.getAttribute('alt')).toBe(
            '₱1,000 bill',
        );
    });

    it('tells a coin from the bill of the same value', () => {
        expect(mount('coin-20').querySelector('img')?.getAttribute('alt')).toBe(
            '₱20 coin',
        );
    });

    it('shows text, not a broken image, for an unknown id', () => {
        const host = mount('coin-2');
        expect(host.querySelector('img')).toBeNull();
        const fallback = host.querySelector(
            '[data-testid="denomination-fallback"]',
        );
        expect(fallback?.textContent).toBe('coin-2');
        expect(fallback?.classList.contains('w-14')).toBe(true);
    });
});
