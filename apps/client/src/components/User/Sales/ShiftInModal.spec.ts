import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { DEFAULT_TERMINAL, ShiftStatus } from '@grocery-pos/contracts';
import { useShiftStore } from '@/stores/shift';
import ShiftInModal from './ShiftInModal.vue';
import { COUNTS_INVALID, FLOAT_REQUIRED } from './shift';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/router', () => ({ default: router }));

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset();
    api.post.mockReset();
    router.push.mockReset();
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

async function openModal() {
    const shift = useShiftStore();
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(ShiftInModal);
    app.use(pinia);
    app.mount(host);
    shift.shiftInOpen = true;
    await flush();
    return shift;
}

function field(id: string): HTMLInputElement {
    return document.querySelector<HTMLInputElement>(
        `[data-testid="count-${id}"]`,
    )!;
}

async function type(id: string, text: string) {
    field(id).value = text;
    field(id).dispatchEvent(new Event('input'));
    await flush();
}

async function submit() {
    document
        .querySelector<HTMLButtonElement>('[data-testid="shift-in-confirm"]')!
        .click();
    await flush();
}

function errorText(): string | undefined {
    return document.querySelector('[data-testid="shift-in-error"]')
        ?.textContent;
}

describe('ShiftInModal (issue #25)', () => {
    it('explains a ₱0 float instead of silently doing nothing', async () => {
        const shift = await openModal();

        await submit();

        expect(errorText()).toContain(FLOAT_REQUIRED);
        expect(api.post).not.toHaveBeenCalled();
        expect(shift.shiftInOpen).toBe(true);
    });

    it('clears that message once a count is entered', async () => {
        await openModal();
        await submit();

        await type('100', '1');

        expect(errorText()).toBeUndefined();
    });

    it('refuses a count with a refused field and says so', async () => {
        await openModal();
        await type('1000', '1');
        await type('500', '1.5');

        await submit();

        expect(errorText()).toContain(COUNTS_INVALID);
        expect(api.post).not.toHaveBeenCalled();
    });

    it('shows the running total while typing and opens with the counts', async () => {
        const shift = await openModal();
        api.post.mockResolvedValue({
            data: {
                _id: 's1',
                status: ShiftStatus.OPEN,
                cashierName: 'ana',
                terminal: DEFAULT_TERMINAL,
                openedAt: '2026-09-25T00:00:00.000Z',
                openingFloat: 250_025,
                movements: [],
            },
        });

        await type('1000', '2');
        await type('500', '1');
        await type('coin-25c', '1');
        expect(document.body.textContent).toContain('₱2,500.25');
        expect(document.body.textContent).toContain('(4 pieces)');

        await submit();

        expect(api.post).toHaveBeenCalledWith('/shifts', {
            counts: { '1000': 2, '500': 1, 'coin-25c': 1 },
        });
        expect(shift.shiftInOpen).toBe(false);
        expect(router.push).toHaveBeenCalledWith({ name: 'Sell' });
    });

    it('starts from an empty count every time it opens', async () => {
        const shift = await openModal();
        await type('1000', '3');
        await type('500', 'x');
        await submit();
        expect(errorText()).toBeTruthy();

        shift.shiftInOpen = false;
        await flush();
        shift.shiftInOpen = true;
        await flush();

        expect(field('1000').value).toBe('');
        expect(field('500').value).toBe('');
        expect(document.querySelector('[data-testid^="count-error-"]')).toBe(
            null,
        );
        expect(errorText()).toBeUndefined();
        expect(document.body.textContent).toContain('(0 pieces)');
    });
});
