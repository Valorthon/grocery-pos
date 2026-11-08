import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { DEFAULT_TERMINAL, ShiftStatus } from '@grocery-pos/contracts';
import { useShiftStore } from '@/stores/shift';
import SellerDashboard from './SellerDashboard.vue';
import { formatShiftDuration } from './shift-duration';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({
    useRouter: () => ({ push }),
    useRoute: () => ({ meta: { title: 'Dashboard' }, matched: [] }),
}));

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
    push.mockReset();
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
        expect(text).toContain('Shift open');
        expect(text).not.toMatch(/drawer cash/i);
        expect(text).not.toContain('₱');
        expect(text).not.toMatch(/expected|variance|over\/short|total|sales/i);
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

const openShift = {
    _id: 's1',
    status: ShiftStatus.OPEN,
    cashierName: 'ana',
    terminal: DEFAULT_TERMINAL,
    openedAt: '2026-09-25T00:00:00.000Z',
    openingFloat: 100_000,
    movements: [],
};

describe('SellerDashboard shift hero (#167)', () => {
    it('shows a loading state until the shift is known', async () => {
        mount();
        await flush();
        expect(
            document.querySelector('[data-testid="shift-loading"]'),
        ).not.toBeNull();
        expect(
            document.querySelector('[data-testid="start-shift"]'),
        ).toBeNull();
        expect(
            document.querySelector('[data-testid="go-to-register"]'),
        ).toBeNull();
    });

    it('has one h1 and an open shift with opened-at, duration and the register as the main action', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-25T02:05:30.000Z'));
        try {
            const shift = useShiftStore();
            shift.activeShift = openShift;
            shift.loaded = true;
            mount();
            await flush();

            expect(document.querySelectorAll('h1')).toHaveLength(1);
            expect(
                document.querySelector('[data-testid="shift-opened-at"]')!
                    .textContent,
            ).toContain('8:00');
            expect(
                document
                    .querySelector('[data-testid="shift-duration"]')!
                    .textContent!.trim(),
            ).toBe('2h 05m');
            const go = document.querySelector<HTMLButtonElement>(
                '[data-testid="go-to-register"]',
            )!;
            expect(go.className).toContain('bg-citrus-500');
            expect(go.className).toContain('min-h-11');
            const end = document.querySelector<HTMLButtonElement>(
                '[data-testid="end-shift"]',
            )!;
            expect(end.className).not.toContain('citrus');
            expect(document.querySelectorAll('.bg-citrus-500')).toHaveLength(1);
            go.click();
            expect(push).toHaveBeenCalledWith({ name: 'Sell' });
            end.click();
            expect(shift.shiftOutOpen).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('offers Start shift when no shift is open', async () => {
        const shift = useShiftStore();
        shift.loaded = true;
        mount();
        await flush();
        expect(document.body.textContent).toContain('No open shift');
        expect(document.querySelector('[data-testid="end-shift"]')).toBeNull();
        document
            .querySelector<HTMLButtonElement>('[data-testid="start-shift"]')!
            .click();
        expect(shift.shiftInOpen).toBe(true);
    });
});

describe('formatShiftDuration', () => {
    const t0 = Date.parse('2026-09-25T00:00:00.000Z');
    it('formats minutes and hours', () => {
        expect(formatShiftDuration('2026-09-25T00:00:00.000Z', t0)).toBe('0m');
        expect(
            formatShiftDuration('2026-09-25T00:00:00.000Z', t0 + 59_999),
        ).toBe('0m');
        expect(
            formatShiftDuration('2026-09-25T00:00:00.000Z', t0 + 12 * 60_000),
        ).toBe('12m');
        expect(
            formatShiftDuration(
                '2026-09-25T00:00:00.000Z',
                t0 + 26 * 3_600_000 + 7 * 60_000,
            ),
        ).toBe('26h 07m');
    });
    it('never goes negative and ignores a bad date', () => {
        expect(
            formatShiftDuration('2026-09-25T00:00:00.000Z', t0 - 60_000),
        ).toBe('0m');
        expect(formatShiftDuration('nope', t0)).toBe('');
    });
});
