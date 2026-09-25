import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import {
    DEFAULT_TERMINAL,
    ShiftStatus,
    type ZReadReport,
} from '@grocery-pos/contracts';
import { useShiftStore } from '@/stores/shift';
import ShiftOutModal from './ShiftOutModal.vue';
import ZReadReportView from './ZReadReportView.vue';
import { COUNTS_INVALID } from './shift';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const REPORT: ZReadReport = {
    shiftId: 'shift1',
    cashierName: 'ana',
    terminal: DEFAULT_TERMINAL,
    openedAt: '2026-09-25T00:00:00.000Z',
    closedAt: '2026-09-25T08:00:00.000Z',
    closedByName: 'boss',
    closedByAdmin: true,
    sales: {
        count: 4,
        gross: 175_000,
        discounts: { count: 1, amount: 10_000 },
        voids: { count: 1, amount: 20_000 },
        refunds: { count: 0, amount: 0 },
        net: 155_000,
    },
    tenders: { cash: 95_000, gcash: 80_000 },
    drawer: {
        openingFloat: 100_000,
        cashIn: 20_000,
        cashDrops: 50_000,
        reversalPayouts: { count: 1, amount: 20_000 },
        expectedCash: 145_000,
        countedCash: 144_000,
        overShort: -1_000,
    },
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

function mount(component: object, props: Record<string, unknown> = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(component, props);
    app.use(pinia);
    app.mount(host);
}

/** Types `pieces` into the count field of the first denomination (₱1,000). */
async function countThousands(pieces: number) {
    await typeCount('1000', String(pieces));
}

async function typeCount(id: string, text: string) {
    const input = document.querySelector<HTMLInputElement>(
        `[data-testid="count-${id}"]`,
    )!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await flush();
}

describe('ShiftOutModal (blind close, issue #2)', () => {
    async function openModal() {
        const shift = useShiftStore();
        shift.activeShift = {
            _id: 'shift1',
            status: ShiftStatus.OPEN,
            cashierName: 'ana',
            terminal: DEFAULT_TERMINAL,
            openedAt: '2026-09-25T00:00:00.000Z',
            openingFloat: 100_000,
            movements: [],
        };
        shift.loaded = true;
        mount(ShiftOutModal);
        shift.shiftOutOpen = true;
        await flush();
        return shift;
    }

    it('shows only what was counted: no expected cash, no variance', async () => {
        await openModal();
        await countThousands(2);

        const text = document.body.textContent ?? '';
        expect(
            document.querySelector('[data-testid="counted-cash"]')?.textContent,
        ).toContain('2,000.00');
        expect(text).not.toMatch(/variance|expected|over|short/i);
        // The opening float is not echoed back either.
        expect(text).not.toContain('1,000.00');
    });

    it('submits the counts, not a total, and shows the server’s Z-read', async () => {
        const shift = await openModal();
        api.post.mockResolvedValue({ data: REPORT });
        await countThousands(2);

        document
            .querySelector<HTMLButtonElement>(
                '[data-testid="shift-out-confirm"]',
            )!
            .click();
        await flush();

        expect(api.post).toHaveBeenCalledWith('/shifts/current/close', {
            counts: { '1000': 2 },
        });
        expect(shift.zRead).toEqual(REPORT);
        expect(shift.activeShift).toBeNull();
        expect(shift.shiftOutOpen).toBe(false);
    });

    it('starts from an empty count every time it opens', async () => {
        const shift = await openModal();
        await countThousands(2);
        await typeCount('500', '1.5');

        shift.shiftOutOpen = false;
        await flush();
        shift.shiftOutOpen = true;
        await flush();

        expect(
            document.querySelector('[data-testid="counted-cash"]')?.textContent,
        ).toContain('0.00');
        expect(
            document.querySelector<HTMLInputElement>(
                '[data-testid="count-1000"]',
            )!.value,
        ).toBe('');
        expect(document.querySelector('[data-testid^="count-error-"]')).toBe(
            null,
        );
    });

    it('does not submit a count with a refused field', async () => {
        await openModal();
        await countThousands(2);
        await typeCount('500', '1.5');

        document
            .querySelector<HTMLButtonElement>(
                '[data-testid="shift-out-confirm"]',
            )!
            .click();
        await flush();

        expect(api.post).not.toHaveBeenCalled();
        expect(
            document.querySelector('[data-testid="shift-out-error"]')
                ?.textContent,
        ).toContain(COUNTS_INVALID);
    });

    it('keeps the modal open with the server’s message when the close fails', async () => {
        const shift = await openModal();
        api.post.mockRejectedValue(new Error('offline'));

        document
            .querySelector<HTMLButtonElement>(
                '[data-testid="shift-out-confirm"]',
            )!
            .click();
        await flush();

        expect(shift.shiftOutOpen).toBe(true);
        expect(shift.activeShift).not.toBeNull();
        expect(
            document.querySelector('[data-testid="shift-out-error"]')
                ?.textContent,
        ).toContain('Could not close the shift');
    });
});

describe('ZReadReportView', () => {
    it('shows the server’s figures as sent, including who force-closed it', async () => {
        mount(ZReadReportView, { report: REPORT });
        await flush();

        const text = document.body.textContent ?? '';
        expect(text).toContain('Shift Close Report (Z-Read)');
        expect(text).not.toMatch(/official/i);
        expect(
            document.querySelector('[data-testid="zread-expected"]')
                ?.textContent,
        ).toContain('1,450.00');
        const overShort = document.querySelector(
            '[data-testid="zread-over-short"]',
        )?.textContent;
        expect(overShort).toContain('SHORT');
        expect(overShort).toContain('10.00');
        expect(
            document.querySelector('[data-testid="zread-closed-by-admin"]')
                ?.textContent,
        ).toContain('boss');
        expect(text).toContain('1,750.00'); // gross
        expect(text).toContain('800.00'); // GCash
    });

    it('does not flag a cashier’s own close as an admin close', async () => {
        mount(ZReadReportView, {
            report: { ...REPORT, closedByAdmin: false, closedByName: 'ana' },
        });
        await flush();

        expect(
            document.querySelector('[data-testid="zread-closed-by-admin"]'),
        ).toBeNull();
    });
});
