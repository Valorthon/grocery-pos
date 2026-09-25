import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import {
    PaymentType,
    Role,
    SaleStatus,
    ShiftStatus,
    TenderType,
} from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';
import Index from './Index.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const OWN_SHIFT = 'shift-own';
const OTHER_SHIFT = 'shift-other';

function openShift(_id: string, cashierName: string) {
    return {
        _id,
        status: ShiftStatus.OPEN,
        cashierName,
        terminal: 'Lane #1',
        openedAt: '2026-09-25T00:00:00.000Z',
        closedAt: null,
        openingFloat: 100_000,
        report: null,
    };
}

/** A ₱800 cash sale paid with ₱1,000: ₱800 net cash to pay back. */
const CASH_SALE = {
    _id: 'sale1',
    cashier: { name: 'ana' },
    amount: 80_000,
    paymentType: PaymentType.CASH,
    tenders: [{ type: TenderType.CASH, amount: 100_000 }],
    changeGiven: 20_000,
    status: SaleStatus.COMPLETED,
    createdAt: '2026-09-25T01:00:00.000Z',
    shift: OWN_SHIFT,
};

let app: App | null = null;
let pinia: Pinia;

function serve(sale: object, open: object[]) {
    api.get.mockImplementation((url: string) => {
        if (url === '/sales') {
            return Promise.resolve({ data: { data: [sale], totalItems: 1 } });
        }
        if (url === '/shifts') {
            return Promise.resolve({
                data: { data: open, totalItems: open.length },
            });
        }
        return Promise.resolve({ data: [] });
    });
}

async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 5; i++) await nextTick();
}

async function startVoid() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Index);
    app.use(pinia);
    app.mount(host);
    await flush();

    document.querySelector<HTMLElement>('tbody tr.cursor-pointer')!.click();
    await flush();
    const voidButton = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Void sale',
    )!;
    voidButton.click();
    await flush();

    const reason =
        document.querySelector<HTMLInputElement>('#reversal-reason')!;
    reason.value = 'mis-ring';
    reason.dispatchEvent(new Event('input'));
    await flush();
}

function confirmButton() {
    return [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Confirm void'),
    )!;
}

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset();
    api.post.mockReset().mockResolvedValue({ data: {} });
    useAuthStore().user = { username: 'boss', roles: [Role.Admin] };
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('admin void/refund cash payout (issue #2)', () => {
    it('pays back from the sale’s own shift while it is open, without asking', async () => {
        serve(CASH_SALE, [openShift(OWN_SHIFT, 'ana')]);
        await startVoid();

        expect(
            document.querySelector('[data-testid="payout-own-shift"]')
                ?.textContent,
        ).toContain('800.00');
        expect(
            document.querySelector('[data-testid="payout-shift"]'),
        ).toBeNull();

        confirmButton().click();
        await flush();

        expect(api.post).toHaveBeenCalledWith('/sales/sale1/void', {
            reason: 'mis-ring',
        });
    });

    it('makes the admin choose an open shift when the sale’s shift is closed', async () => {
        serve(CASH_SALE, [openShift(OTHER_SHIFT, 'ben')]);
        await startVoid();

        const select = document.querySelector<HTMLSelectElement>(
            '[data-testid="payout-shift"] select',
        )!;
        expect(select).not.toBeNull();
        // Nothing is preselected: confirm waits for a choice.
        expect(select.value).toBe('');
        expect(confirmButton().disabled).toBe(true);

        select.value = OTHER_SHIFT;
        select.dispatchEvent(new Event('change'));
        await flush();
        expect(confirmButton().disabled).toBe(false);
        confirmButton().click();
        await flush();

        expect(api.post).toHaveBeenCalledWith('/sales/sale1/void', {
            reason: 'mis-ring',
            payoutShiftId: OTHER_SHIFT,
        });
    });

    it('asks for a shift for a sale from before shifts', async () => {
        serve({ ...CASH_SALE, shift: undefined }, [
            openShift(OTHER_SHIFT, 'ben'),
        ]);
        await startVoid();

        expect(
            document.querySelector('[data-testid="payout-shift"] select'),
        ).not.toBeNull();
    });

    it('blocks the reversal when cash is owed and no shift is open', async () => {
        serve(CASH_SALE, []);
        await startVoid();

        expect(
            document.querySelector('[data-testid="payout-no-open-shift"]'),
        ).not.toBeNull();
        expect(confirmButton().disabled).toBe(true);
    });

    it('asks nothing for a GCash-only sale, which touches no drawer', async () => {
        serve(
            {
                ...CASH_SALE,
                paymentType: PaymentType.GCASH,
                tenders: [{ type: TenderType.GCASH, amount: 80_000 }],
                changeGiven: 0,
                referenceNumber: '1234567890123',
            },
            [],
        );
        await startVoid();

        expect(
            document.querySelector('[data-testid="payout-none"]'),
        ).not.toBeNull();
        expect(api.get).not.toHaveBeenCalledWith('/shifts', expect.anything());

        confirmButton().click();
        await flush();
        expect(api.post).toHaveBeenCalledWith('/sales/sale1/void', {
            reason: 'mis-ring',
        });
    });
});
