// LAN terminals need a saved terminal label before a shift (#399, owner
// decision 2026-11-20). Client-only: the label has no permission meaning.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { ShiftStatus } from '@grocery-pos/contracts';
import { useShiftStore } from '@/stores/shift';
import {
    hasSavedTerminalLabel,
    isLanTerminal,
    saveTerminalLabel,
    TERMINAL_LABEL_REQUIRED,
} from '@/settings/presentation';
import ShiftInModal from './ShiftInModal.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/router', () => ({ default: router }));
// A single-pc build; jsdom's hostname is fixed at localhost, so the modal
// reads this one.
const host = vi.hoisted(() => ({ name: '192.168.1.10' }));
vi.mock('@/settings/presentation', async (importOriginal) => {
    const real =
        await importOriginal<typeof import('@/settings/presentation')>();
    return {
        ...real,
        isLanTerminal: (appEnv = 'single-pc', hostname = host.name) =>
            real.isLanTerminal(appEnv, hostname),
    };
});

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.post.mockReset();
    router.push.mockReset();
    host.name = '192.168.1.10';
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
    const el = document.createElement('div');
    document.body.appendChild(el);
    app = createApp(ShiftInModal);
    app.use(pinia);
    app.mount(el);
    shift.shiftInOpen = true;
    await flush();
}

async function countAndSubmit() {
    const field = document.querySelector<HTMLInputElement>(
        '[data-testid="count-1000"]',
    )!;
    field.value = '1';
    field.dispatchEvent(new Event('input'));
    await flush();
    document
        .querySelector<HTMLButtonElement>('[data-testid="shift-in-confirm"]')!
        .click();
    await flush();
}

const confirmButton = () =>
    document.querySelector<HTMLButtonElement>(
        '[data-testid="shift-in-confirm"]',
    )!;
const errorText = () =>
    document.querySelector('[data-testid="shift-in-error"]')?.textContent;

describe('isLanTerminal (#399)', () => {
    it('is any single-pc address but localhost', () => {
        expect(isLanTerminal('single-pc', '192.168.1.10')).toBe(true);
        expect(isLanTerminal('single-pc', 'localhost')).toBe(false);
        expect(isLanTerminal('prod', 'pos.example.com')).toBe(false);
        expect(isLanTerminal('dev', '192.168.1.10')).toBe(false);
    });
});

// Order matters: the saved label lives in module state, as in the app.
describe('ShiftInModal on a LAN terminal (#399)', () => {
    it('an unlabelled LAN terminal cannot open a shift and says why', async () => {
        expect(hasSavedTerminalLabel()).toBe(false);
        await openModal();
        expect(errorText()).toContain(TERMINAL_LABEL_REQUIRED);
        expect(confirmButton().disabled).toBe(true);
        await countAndSubmit();
        expect(api.post).not.toHaveBeenCalled();
    });

    it('localhost (the main PC) is unaffected without a label', async () => {
        host.name = 'localhost';
        await openModal();
        expect(errorText() ?? '').not.toContain(TERMINAL_LABEL_REQUIRED);
        expect(confirmButton().disabled).toBe(false);
    });

    it('a labelled LAN terminal opens a shift with its label', async () => {
        expect(saveTerminalLabel('Lane 2')).toBe(true);
        expect(hasSavedTerminalLabel()).toBe(true);
        api.post.mockResolvedValue({
            data: {
                _id: 's1',
                status: ShiftStatus.OPEN,
                terminal: 'Lane 2',
                openedAt: new Date().toISOString(),
                openingFloat: 100000,
            },
        });
        await openModal();
        expect(errorText()).toBeUndefined();
        await countAndSubmit();
        expect(api.post).toHaveBeenCalledWith(
            '/shifts',
            expect.objectContaining({ terminal: 'Lane 2' }),
        );
    });
});
