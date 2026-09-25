import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import {
    DEFAULT_TERMINAL,
    DrawerMovementType,
    STRING_LIMITS,
    ShiftStatus,
} from '@grocery-pos/contracts';
import { useShiftStore } from '@/stores/shift';
import { useUIStore } from '@/stores/ui';
import DrawerActionModal from './DrawerActionModal.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const SHIFT = {
    _id: 'shift1',
    status: ShiftStatus.OPEN,
    cashierName: 'ana',
    terminal: DEFAULT_TERMINAL,
    openedAt: '2026-09-25T00:00:00.000Z',
    openingFloat: 100_000,
    movements: [],
};

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset();
    api.post.mockReset();
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

async function openModal(action: DrawerMovementType) {
    const shift = useShiftStore();
    shift.activeShift = { ...SHIFT };
    shift.loaded = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(DrawerActionModal);
    app.use(pinia);
    app.mount(host);
    shift.drawerAction = action as typeof shift.drawerAction;
    await flush();
    return shift;
}

function input(id: string): HTMLInputElement {
    return document.querySelector<HTMLInputElement>(
        `[data-testid="drawer-${id}"]`,
    )!;
}

async function type(id: string, text: string) {
    input(id).value = text;
    input(id).dispatchEvent(new Event('input'));
    await flush();
}

async function submit() {
    document
        .querySelector<HTMLButtonElement>('[data-testid="drawer-confirm"]')!
        .click();
    await flush();
}

function errorOf(id: string): string | undefined {
    return document.querySelector(`[data-testid="drawer-${id}-error"]`)
        ?.textContent;
}

describe('DrawerActionModal (issue #25)', () => {
    it.each([DrawerMovementType.CASH_IN, DrawerMovementType.CASH_DROP])(
        'opens %s with no amount and no reason',
        async (action) => {
            await openModal(action);

            expect(input('amount').value).toBe('');
            expect(input('reason').value).toBe('');
        },
    );

    it('refuses a missing amount and reason inline, with no request', async () => {
        const shift = await openModal(DrawerMovementType.CASH_DROP);

        await submit();

        expect(errorOf('amount')).toContain('required');
        expect(errorOf('reason')).toContain('required');
        expect(api.post).not.toHaveBeenCalled();
        expect(shift.drawerAction).toBe(DrawerMovementType.CASH_DROP);
    });

    it('refuses a blank reason even with an amount', async () => {
        await openModal(DrawerMovementType.CASH_IN);
        await type('amount', '500');
        await type('reason', '   ');

        await submit();

        expect(errorOf('amount')).toBeUndefined();
        expect(errorOf('reason')).toContain('required');
        expect(api.post).not.toHaveBeenCalled();
    });

    it.each([
        ['0', 'at least'],
        ['1.005', 'up to 2 decimals'],
        ['abc', 'up to 2 decimals'],
        ['10000000.01', 'At most'],
    ])('refuses an amount of %j', async (amount, message) => {
        await openModal(DrawerMovementType.CASH_IN);
        await type('amount', amount);
        await type('reason', 'coins');

        await submit();

        expect(errorOf('amount')).toContain(message);
        expect(api.post).not.toHaveBeenCalled();
    });

    it('clears a field’s error once it is edited', async () => {
        await openModal(DrawerMovementType.CASH_IN);
        await submit();

        await type('reason', 'c');

        expect(errorOf('reason')).toBeUndefined();
        expect(errorOf('amount')).toBeTruthy();
    });

    it('sends the typed pesos as centavos with the trimmed reason', async () => {
        const shift = await openModal(DrawerMovementType.CASH_DROP);
        api.post.mockResolvedValue({ data: { ...SHIFT } });
        await type('amount', '1234.56');
        await type('reason', '  Excess to safe ');

        await submit();

        expect(api.post).toHaveBeenCalledWith('/shifts/current/drawer', {
            type: DrawerMovementType.CASH_DROP,
            amount: 123_456,
            reason: 'Excess to safe',
        });
        expect(shift.drawerAction).toBeNull();
    });

    it('uses a quick amount as typed centavos', async () => {
        await openModal(DrawerMovementType.CASH_IN);
        api.post.mockResolvedValue({ data: { ...SHIFT } });
        const quick = [...document.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === '₱200.00',
        )!;
        quick.click();
        await flush();
        expect(input('amount').value).toBe('200.00');
        await type('reason', 'coins');

        await submit();

        expect(api.post).toHaveBeenCalledWith('/shifts/current/drawer', {
            type: DrawerMovementType.CASH_IN,
            amount: 20_000,
            reason: 'coins',
        });
    });

    it('does not check a drop against the drawer (blind, #2)', async () => {
        await openModal(DrawerMovementType.CASH_DROP);
        api.post.mockResolvedValue({ data: { ...SHIFT } });
        // Far more than the ₱1,000 float.
        await type('amount', '50000');
        await type('reason', 'safe');

        await submit();

        expect(api.post).toHaveBeenCalledTimes(1);
    });

    it('limits the reason to the API length', async () => {
        await openModal(DrawerMovementType.CASH_IN);

        expect(input('reason').maxLength).toBe(STRING_LIMITS.REASON);
    });

    it('keeps the modal open and toasts when the server refuses', async () => {
        const shift = await openModal(DrawerMovementType.CASH_IN);
        api.post.mockRejectedValue(new Error('offline'));
        await type('amount', '100');
        await type('reason', 'coins');

        await submit();

        expect(shift.drawerAction).toBe(DrawerMovementType.CASH_IN);
        expect(useUIStore().toasts.flatMap((t) => t.lines)).toContain(
            'Could not record the movement',
        );
        expect(input('amount').value).toBe('100');
    });

    it('starts empty again after an earlier entry', async () => {
        const shift = await openModal(DrawerMovementType.CASH_IN);
        await type('amount', '100');
        await type('reason', 'coins');
        shift.drawerAction = null;
        await flush();

        shift.drawerAction = DrawerMovementType.CASH_DROP;
        await flush();

        expect(input('amount').value).toBe('');
        expect(input('reason').value).toBe('');
    });
});

describe('DrawerActionModal while submitting (issue #22)', () => {
    it('hides × and ignores Escape until the request settles', async () => {
        const shift = await openModal(DrawerMovementType.CASH_IN);
        let settle!: (v: unknown) => void;
        api.post.mockReturnValue(new Promise((r) => (settle = r)));
        await type('amount', '500');
        await type('reason', 'coins');
        await submit();

        expect(document.querySelector('[data-modal-close]')).toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flush();
        expect(shift.drawerAction).toBe(DrawerMovementType.CASH_IN);

        settle({ data: { ...SHIFT } });
        await flush();
        expect(shift.drawerAction).toBeNull();
    });
});
