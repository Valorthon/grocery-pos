import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
    DEFAULT_TERMINAL,
    type ShiftListItem,
    ShiftStatus,
} from '@grocery-pos/contracts';
import { COUNTS_INVALID } from '@/components/User/Sales/shift';
import ShiftsIndex from './Index.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const OPEN_SHIFT: ShiftListItem = {
    _id: 'shift1',
    status: ShiftStatus.OPEN,
    cashierName: 'ana',
    terminal: DEFAULT_TERMINAL,
    openedAt: '2026-09-25T00:00:00.000Z',
    closedAt: null,
    openingFloat: 100_000,
    report: null,
};

let app: App | null = null;

beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockResolvedValue({ data: { data: [OPEN_SHIFT], totalItems: 1 } });
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 5; i++) await nextTick();
}

async function typeCount(id: string, text: string) {
    const input = document.querySelector<HTMLInputElement>(
        `[data-testid="count-${id}"]`,
    )!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await flush();
}

function forceCloseButton(): HTMLButtonElement {
    return [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Force-close shift'),
    )!;
}

function errorText(): string | undefined {
    return document.querySelector('[data-testid="force-close-error"]')
        ?.textContent;
}

describe('Shifts admin force-close (issue #25)', () => {
    it('refuses a count with a flagged field, and clears that once edited', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(ShiftsIndex);
        app.use(createPinia());
        app.mount(host);
        await flush();

        [...document.querySelectorAll('tr')]
            .find((tr) => tr.textContent?.includes('ana'))!
            .click();
        await flush();

        await typeCount('1000', '2');
        await typeCount('500', '1.5');
        forceCloseButton().click();
        await flush();

        expect(api.post).not.toHaveBeenCalled();
        expect(errorText()).toContain(COUNTS_INVALID);
        expect(
            document
                .querySelector('[data-testid="force-close-error"]')
                ?.getAttribute('role'),
        ).toBe('alert');

        await typeCount('500', '1');
        expect(errorText()).toBeUndefined();
    });
});
