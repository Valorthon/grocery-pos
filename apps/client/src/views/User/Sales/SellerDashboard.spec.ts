import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { DEFAULT_TERMINAL, ShiftStatus } from '@grocery-pos/contracts';
import { useShiftStore } from '@/stores/shift';
import SellerDashboard from './SellerDashboard.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let app: App | null = null;
let pinia: Pinia;

async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 5; i++) await nextTick();
}

function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(SellerDashboard);
    app.use(pinia);
    app.mount(host);
}

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset();
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('SellerDashboard (issue #2)', () => {
    it('shows no drawer cash during a shift: the cashier counts blind', async () => {
        const shift = useShiftStore();
        shift.activeShift = {
            _id: 's1',
            status: ShiftStatus.OPEN,
            cashierName: 'ana',
            terminal: DEFAULT_TERMINAL,
            openedAt: '2026-09-25T00:00:00.000Z',
            openingFloat: 100_000,
            movements: [],
        };
        shift.loaded = true;

        mount();
        await flush();

        const text = document.body.textContent ?? '';
        expect(text).toContain('Active Shift');
        expect(text).not.toMatch(/drawer cash/i);
        expect(text).not.toContain('₱');
    });

    it('reopens the last shift report from the server', async () => {
        const report = { shiftId: 's0' };
        api.get.mockResolvedValue({ data: { report } });
        const shift = useShiftStore();
        shift.loaded = true;

        mount();
        await flush();
        document
            .querySelector<HTMLButtonElement>(
                '[data-testid="last-shift-report"]',
            )!
            .click();
        await flush();

        expect(api.get).toHaveBeenCalledWith('/shifts/last-closed');
        expect(shift.zRead).toEqual(report);
    });
});
