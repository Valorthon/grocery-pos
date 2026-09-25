import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import type { ZReadReport } from '@grocery-pos/contracts';
import { useShiftStore } from '@/stores/shift';
import ZReadModal from './ZReadModal.vue';

vi.mock('@/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const REPORT: ZReadReport = {
    shiftId: 'shift1',
    cashierName: 'bea',
    // Not DEFAULT_TERMINAL: the modal shows what the report stored.
    terminal: 'Lane #7',
    openedAt: '2026-09-25T00:00:00.000Z',
    closedAt: '2026-09-25T08:00:00.000Z',
    closedByName: 'bea',
    closedByAdmin: false,
    sales: {
        count: 0,
        gross: 0,
        discounts: { count: 0, amount: 0 },
        voids: { count: 0, amount: 0 },
        refunds: { count: 0, amount: 0 },
        net: 0,
    },
    tenders: { cash: 0, gcash: 0 },
    drawer: {
        openingFloat: 100_000,
        cashIn: 0,
        cashDrops: 0,
        reversalPayouts: { count: 0, amount: 0 },
        expectedCash: 100_000,
        countedCash: 100_000,
        overShort: 0,
    },
    movements: [],
};

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount() {
    useShiftStore().zRead = REPORT;
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(ZReadModal);
    app.use(pinia);
    app.mount(host);
    for (let i = 0; i < 5; i++) await nextTick();
}

describe('ZReadModal (issue #24)', () => {
    it('has no Print button', async () => {
        await mount();
        const buttons = [...document.querySelectorAll('button')].map((b) =>
            b.textContent?.trim(),
        );
        expect(buttons).not.toContain('Print');
        expect(buttons).toContain('Back to Dashboard');
    });

    it("takes the terminal and cashier from the stored report, times in the store's zone", async () => {
        await mount();
        const text = document.querySelector('[role="dialog"]')!.textContent!;
        expect(
            document.querySelector('[data-testid="zread-terminal"]')
                ?.textContent,
        ).toBe('Lane #7');
        expect(
            document.querySelector('[data-testid="zread-cashier"]')
                ?.textContent,
        ).toContain('Cashier: bea');
        expect(text).toContain('Sep 25, 2026, 8:00 AM');
        expect(text).toContain('Sep 25, 2026, 4:00 PM');
        expect(text).not.toContain('Grocery POS Store');
    });
});
