import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { ShiftStatus } from '@grocery-pos/contracts';
import { useCartStore, cartStorageKey } from './cart';
import { useShiftStore } from './shift';
import { useUIStore } from './ui';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
const MILK = {
    product: 'p1',
    EAN: '2000000000015',
    name: 'milk',
    unitPrice: 9500,
};
const REPORT = { shiftId: 's' };
let pinia = createPinia();
beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
    api.post.mockResolvedValue({ data: REPORT });
});
afterEach(() => disposePinia(pinia));
function setup() {
    const cart = useCartStore();
    cart.setOwner('ana');
    cart.add(MILK);
    cart.park('', 's');
    const shift = useShiftStore();
    shift.activeShift = {
        _id: 's',
        cashierName: 'ana',
        status: ShiftStatus.OPEN,
        terminal: 'Lane 1',
        openedAt: new Date().toISOString(),
        openingFloat: 100,
        movements: [],
    };
    shift.shiftOutOpen = true;
    return { cart, shift };
}
describe('parked drafts at shift close', () => {
    it('requires an explicit choice before sending the close request', async () => {
        const { cart, shift } = setup();
        await expect(shift.closeShift({})).rejects.toThrow(/Choose/);
        expect(api.post).not.toHaveBeenCalled();
        expect(cart.parked).toHaveLength(1);
        expect(shift.activeShift).not.toBeNull();
    });
    it.each(['carry', 'discard'] as const)(
        'applies %s only after a successful close',
        async (choice) => {
            const { cart, shift } = setup();
            await shift.closeShift({}, choice);
            expect(shift.zRead).toEqual(REPORT);
            expect(shift.activeShift).toBeNull();
            expect(cart.parked).toHaveLength(choice === 'carry' ? 1 : 0);
            expect(cart.locked).toBe(false);
            if (choice === 'carry') expect(cart.parked[0].shiftId).toBeNull();
        },
    );
    it('keeps all drafts when the API rejects close', async () => {
        const { cart, shift } = setup();
        api.post.mockRejectedValue(new Error('offline'));
        await expect(shift.closeShift({}, 'discard')).rejects.toThrow(
            'offline',
        );
        expect(cart.parked).toHaveLength(1);
        expect(cart.locked).toBe(false);
        expect(shift.activeShift).not.toBeNull();
    });
    it('locks parking/resume during close and ignores a response after logout', async () => {
        const { cart, shift } = setup();
        let finish!: (value: unknown) => void;
        api.post.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        const pending = shift.closeShift({}, 'discard');
        expect(cart.locked).toBe(true);
        expect(() => cart.park('', 's')).toThrow(/Wait/);
        shift.reset();
        cart.reset();
        cart.setOwner('ben');
        finish({ data: REPORT });
        await expect(pending).rejects.toThrow(/Logged out/);
        expect(cart.parked).toEqual([]);
        expect(shift.zRead).toBeNull();
        cart.setOwner('ana');
        expect(cart.parked).toHaveLength(1);
    });
    it('does not claim a successful close failed when local persistence is unavailable', async () => {
        const { cart, shift } = setup();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        await expect(shift.closeShift({}, 'discard')).resolves.toEqual(REPORT);
        expect(shift.activeShift).toBeNull();
        expect(cart.parked).toHaveLength(1);
        expect(useUIStore().toasts[0].lines.join(' ')).toContain(
            'Shift closed, but',
        );
    });
    it('does not discard drafts newly changed in another tab while close was pending', async () => {
        const { cart, shift } = setup();
        let finish!: (value: unknown) => void;
        api.post.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        const pending = shift.closeShift({}, 'discard');
        const raw = JSON.parse(
            localStorage.getItem(cartStorageKey('ana'))!,
        ) as { parked: { label: string }[] };
        raw.parked[0].label = 'updated';
        localStorage.setItem(cartStorageKey('ana'), JSON.stringify(raw));
        finish({ data: REPORT });
        await pending;
        expect(cart.parked[0].label).toBe('updated');
        expect(shift.activeShift).toBeNull();
        expect(useUIStore().toasts).toHaveLength(1);
    });
    it('refuses close while a pending checkout might already be recorded', async () => {
        const { cart, shift } = setup();
        cart.setAttempt({ idempotencyKey: 'pending', ticketSignature: 'same' });
        await expect(shift.closeShift({}, 'carry')).rejects.toThrow(/Finish/);
        expect(api.post).not.toHaveBeenCalled();
    });
});
