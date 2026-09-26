import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { DrawerMovementType, type ZReadReport } from '@grocery-pos/contracts';
import ZReadReportView from './ZReadReportView.vue';

/**
 * The Z-read money figures (issue #30, #2). Every figure is the one the
 * server stored, in centavos, shown with formatCurrency: the client never
 * adds anything up, because the cashier's count is blind and the server's
 * expected cash is the only authority.
 */
const REPORT: ZReadReport = {
    shiftId: 'shift1',
    cashierName: 'bea',
    terminal: 'Lane #1',
    openedAt: '2026-09-25T00:00:00.000Z',
    closedAt: '2026-09-25T08:00:00.000Z',
    closedByName: 'bea',
    closedByAdmin: false,
    sales: {
        count: 12,
        gross: 1_234_550,
        discounts: { count: 2, amount: 12_345 },
        voids: { count: 1, amount: 4_550 },
        refunds: { count: 1, amount: 1_005 },
        net: 1_216_650,
    },
    tenders: { cash: 1_000_010, gcash: 216_640 },
    drawer: {
        openingFloat: 100_000,
        cashIn: 50_000,
        cashDrops: 200_000,
        reversalPayouts: { count: 2, amount: 5_555 },
        // Deliberately not the sum of the rows above: the view shows the
        // server's figure, never its own arithmetic.
        expectedCash: 944_455,
        countedCash: 944_455,
        overShort: 0,
    },
    movements: [],
};

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(report: ZReadReport): Promise<HTMLElement> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(ZReadReportView, { report });
    app.mount(host);
    await nextTick();
    return host;
}

/** The value shown on the row labelled `label`. */
function row(host: HTMLElement, label: string): string | undefined {
    const rows = [...host.querySelectorAll('div.flex.justify-between')];
    const match = rows.find((r) =>
        r.firstElementChild?.textContent?.trim().startsWith(label),
    );
    return match?.lastElementChild?.textContent?.trim();
}

describe('ZReadReportView money figures', () => {
    it('shows every stored figure as pesos with two decimals', async () => {
        const host = await mount(REPORT);

        expect(row(host, 'Transactions')).toBe('12');
        expect(row(host, 'Gross Sales')).toBe('₱12,345.50');
        expect(row(host, 'Discounts Given (2)')).toBe('₱123.45');
        expect(row(host, '(-) Voids (1)')).toBe('₱45.50');
        expect(row(host, '(-) Refunds (1)')).toBe('₱10.05');
        expect(row(host, 'Net Sales')).toBe('₱12,166.50');
        expect(row(host, 'Cash (net of change)')).toBe('₱10,000.10');
        expect(row(host, 'GCash')).toBe('₱2,166.40');
        expect(row(host, 'Opening Float')).toBe('₱1,000.00');
        expect(row(host, '(+) Cash In')).toBe('₱500.00');
        expect(row(host, '(-) Cash Drops')).toBe('₱2,000.00');
        expect(row(host, '(-) Void/Refund Payouts (2)')).toBe('₱55.55');
    });

    it('shows the server’s expected cash as is, not a sum of the rows', async () => {
        const host = await mount(REPORT);
        expect(
            host.querySelector('[data-testid="zread-expected"]')?.textContent,
        ).toContain('₱9,444.55');
    });

    it.each([
        [0, 'VARIANCE (EXACT)', '₱0.00', 'text-emerald-700'],
        [1_050, 'VARIANCE (OVER)', '+₱10.50', 'text-amber-700'],
        [-1_050, 'VARIANCE (SHORT)', '-₱10.50', 'text-rose-700'],
    ])(
        'labels an over/short of %i centavos as %s, signed',
        async (overShort, label, amount, colour) => {
            const host = await mount({
                ...REPORT,
                drawer: { ...REPORT.drawer, overShort },
            });
            const variance = host.querySelector(
                '[data-testid="zread-over-short"]',
            )!;
            const [labelSpan, amountSpan] = variance.querySelectorAll('span');
            expect(labelSpan.textContent).toBe(`${label}:`);
            expect(amountSpan.textContent).toBe(amount);
            expect(variance.classList).toContain(colour);
        },
    );
});

describe('ZReadReportView who and what', () => {
    it('says when an admin force-closed the shift', async () => {
        const plain = await mount(REPORT);
        expect(
            plain.querySelector('[data-testid="zread-closed-by-admin"]'),
        ).toBeNull();
        app!.unmount();

        const forced = await mount({
            ...REPORT,
            closedByAdmin: true,
            closedByName: 'root',
        });
        expect(
            forced.querySelector('[data-testid="zread-closed-by-admin"]')
                ?.textContent,
        ).toContain('Closed by admin root');
    });

    it('lists every drawer movement with its label, reason, who and amount', async () => {
        const host = await mount({
            ...REPORT,
            movements: [
                {
                    type: DrawerMovementType.CASH_IN,
                    amount: 50_000,
                    reason: 'change fund',
                    at: '2026-09-25T01:00:00.000Z',
                    byName: 'bea',
                    sale: null,
                },
                {
                    type: DrawerMovementType.REVERSAL_PAYOUT,
                    amount: 5_555,
                    reason: 'VOID: mis-ring',
                    at: '2026-09-25T02:00:00.000Z',
                    byName: 'root',
                    sale: 'sale1',
                },
            ],
        });
        const text = host.textContent!.replace(/\s+/g, ' ');
        expect(text).toContain('Drawer Movements');
        expect(text).toMatch(/Cash in · change fund \(bea\)\s?₱500\.00/);
        expect(text).toMatch(
            /Void\/refund payout · VOID: mis-ring \(root\)\s?₱55\.55/,
        );
    });

    it('has no movements section when there were none', async () => {
        const host = await mount(REPORT);
        expect(host.textContent).not.toContain('Drawer Movements');
    });
});
