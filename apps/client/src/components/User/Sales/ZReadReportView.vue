<template>
    <div
        class="bg-surface p-5 rounded-control border border-line shadow-2xs space-y-4 num text-xs text-ink"
    >
        <div class="text-center border-b border-dashed border-line-strong pb-3">
            <div
                class="font-sans font-bold text-sm uppercase tracking-wider text-ink"
            >
                {{ identity.storeName }}
            </div>
            <p v-if="identity.branchName">{{ identity.branchName }}</p>
            <p v-if="identity.address">{{ identity.address }}</p>
            <p v-if="identity.contactNumber">{{ identity.contactNumber }}</p>
            <p v-if="identity.tin">TIN {{ identity.tin }}</p>
            <div class="text-xs text-muted font-sans mt-0.5">
                <span data-testid="zread-terminal">{{ report.terminal }}</span>
                • Shift Close Report (Z-Read)
            </div>
            <div class="text-xs text-muted mt-1">
                {{ formatStoreDateTime(report.openedAt, identity.timezone) }} —
                {{ formatStoreDateTime(report.closedAt, identity.timezone) }}
            </div>
            <div
                class="text-xs font-bold text-muted mt-1"
                data-testid="zread-cashier"
            >
                Cashier: {{ report.cashierName }}
            </div>
            <div
                v-if="report.closedByAdmin"
                class="mt-2 rounded-md bg-warning-bg border border-warning-border px-2 py-1 text-xs font-sans font-bold text-warning-fg"
                data-testid="zread-closed-by-admin"
            >
                Closed by admin {{ report.closedByName }}
            </div>
        </div>

        <p
            v-if="report.offlineAddendum"
            class="rounded-control border border-warning-border bg-warning-bg p-3 font-sans text-sm"
            data-testid="offline-addendum"
        >
            Admin reconciliation addendum:
            {{ report.offlineAddendum.count }} offline sales and
            {{ currency(report.offlineAddendum.netCash) }} cash were recorded
            after close. These are separate from the unchanged closing totals
            below.
        </p>
        <section
            class="space-y-1.5 border-b border-dashed border-line-strong pb-3 text-xs"
        >
            <div class="font-sans font-bold text-ink uppercase text-xs">
                Sales
            </div>
            <Row label="Transactions" :value="String(report.sales.count)" />
            <Row
                label="Gross Sales (after discounts)"
                :value="currency(report.sales.gross)"
            />
            <Row
                :label="`Discounts Given (${report.sales.discounts.count})`"
                :value="currency(report.sales.discounts.amount)"
                note="already deducted from gross"
                info
            />
            <Row
                :label="`(-) Voids (${report.sales.voids.count})`"
                :value="currency(report.sales.voids.amount)"
            />
            <Row
                :label="`(-) Refunds (${report.sales.refunds.count})`"
                :value="currency(report.sales.refunds.amount)"
            />
            <Row label="Net Sales" :value="currency(report.sales.net)" bold />
        </section>

        <section
            class="space-y-1.5 border-b border-dashed border-line-strong pb-3 text-xs"
        >
            <div class="font-sans font-bold text-ink uppercase text-xs">
                By Tender
            </div>
            <Row
                label="Cash (net of change)"
                :value="currency(report.tenders.cash)"
            />
            <Row label="GCash" :value="currency(report.tenders.gcash)" />
        </section>

        <section
            class="space-y-1.5 border-b border-dashed border-line-strong pb-3 text-xs"
        >
            <div class="font-sans font-bold text-ink uppercase text-xs">
                Drawer
            </div>
            <Row
                label="Opening Float"
                :value="currency(report.drawer.openingFloat)"
            />
            <Row label="(+) Cash In" :value="currency(report.drawer.cashIn)" />
            <Row
                label="(-) Cash Drops"
                :value="currency(report.drawer.cashDrops)"
            />
            <Row
                label="(+) Cash Sales"
                :value="currency(report.tenders.cash)"
            />
            <Row
                :label="`(-) Void/Refund Payouts (${report.drawer.reversalPayouts.count})`"
                :value="currency(report.drawer.reversalPayouts.amount)"
            />
            <Row
                label="Expected Cash"
                :value="currency(report.drawer.expectedCash)"
                bold
                data-testid="zread-expected"
            />
        </section>

        <div
            class="p-3 bg-paper rounded-control border border-line space-y-1.5 text-xs"
        >
            <div class="flex justify-between font-bold text-ink">
                <span>Physical Cash Counted:</span>
                <span class="text-leaf-600">{{
                    currency(report.drawer.countedCash)
                }}</span>
            </div>
            <div
                class="flex justify-between font-bold pt-1 border-t border-line-strong"
                :class="varianceClass"
                data-testid="zread-over-short"
            >
                <span>{{ varianceLabel }}:</span>
                <span>{{ signed(report.drawer.overShort) }}</span>
            </div>
        </div>

        <section
            v-if="report.movements.length > 0"
            class="space-y-1 text-xs text-muted"
        >
            <div class="font-sans font-bold text-ink uppercase text-xs">
                Drawer Movements
            </div>
            <div
                v-for="(m, i) in report.movements"
                :key="i"
                class="flex justify-between gap-2"
            >
                <span class="truncate"
                    >{{ formatStoreTime(m.at) }} {{ movementLabel(m.type) }} ·
                    {{ m.reason }} ({{ m.byName }})</span
                >
                <span class="shrink-0">{{ currency(m.amount) }}</span>
            </div>
        </section>

        <div class="text-center text-xs text-muted font-sans pt-1">
            --- END OF SHIFT CLOSE REPORT ---
        </div>
    </div>
</template>

<script setup lang="ts">
import { receiptStoreIdentity } from '@grocery-pos/contracts';
import { storePresentation } from '@/settings/presentation';
import { computed, defineComponent, h } from 'vue';
import { DrawerMovementType, type ZReadReport } from '@grocery-pos/contracts';
import { formatCurrency } from '@/utils/currency';
import { formatStoreDateTime, formatStoreTime } from '@/utils/datetime';

/** The server's stored Z-read. Every figure is shown as the server sent it. */
const props = defineProps<{ report: ZReadReport }>();

const Row = defineComponent({
    props: {
        label: { type: String, required: true },
        value: { type: String, required: true },
        bold: { type: Boolean, default: false },
        /** Information only: indented and muted, not part of the sum. */
        info: { type: Boolean, default: false },
        note: { type: String, default: '' },
    },
    setup(p) {
        return () =>
            h(
                'div',
                {
                    class: [
                        'flex justify-between',
                        p.bold ? 'font-bold text-ink' : '',
                        p.info ? 'pl-3 text-muted italic' : '',
                    ],
                    'data-info': p.info ? 'true' : undefined,
                },
                [
                    h('span', { class: p.info ? '' : 'text-muted' }, [
                        `${p.label}:`,
                        p.note
                            ? h('span', { class: 'block' }, `(${p.note})`)
                            : null,
                    ]),
                    h('span', { class: p.info ? '' : 'font-bold' }, p.value),
                ],
            );
    },
});

function currency(value: number): string {
    return formatCurrency(value);
}

function signed(value: number): string {
    return value > 0 ? `+${currency(value)}` : currency(value);
}

const varianceLabel = computed(() => {
    const v = props.report.drawer.overShort;
    if (v === 0) return 'VARIANCE (EXACT)';
    return v > 0 ? 'VARIANCE (OVER)' : 'VARIANCE (SHORT)';
});

const varianceClass = computed(() => {
    const v = props.report.drawer.overShort;
    if (v === 0) return 'text-success-fg';
    return v > 0 ? 'text-warning-fg' : 'text-danger-fg';
});

const MOVEMENT_LABELS: Record<DrawerMovementType, string> = {
    [DrawerMovementType.CASH_IN]: 'Cash in',
    [DrawerMovementType.CASH_DROP]: 'Cash drop',
    [DrawerMovementType.REVERSAL_PAYOUT]: 'Void/refund payout',
};

function movementLabel(type: DrawerMovementType): string {
    return MOVEMENT_LABELS[type] ?? type;
}
const identity = computed(
    () =>
        props.report.storeIdentity ??
        receiptStoreIdentity(storePresentation.value, props.report.terminal),
);
</script>
