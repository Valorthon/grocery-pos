<template>
    <div
        class="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4 font-mono text-xs text-slate-900"
    >
        <div class="text-center border-b border-dashed border-slate-300 pb-3">
            <div
                class="font-sans font-black text-sm uppercase tracking-wider text-slate-900"
            >
                Grocery POS Store
            </div>
            <div class="text-[11px] text-slate-500 font-sans mt-0.5">
                {{ report.terminal }} • Shift Close Report (Z-Read)
            </div>
            <div class="text-[10px] text-slate-400 mt-1">
                {{ formatDate(report.openedAt) }} —
                {{ formatDate(report.closedAt) }}
            </div>
            <div class="text-[11px] font-bold text-slate-700 mt-1">
                Cashier: {{ report.cashierName }}
            </div>
            <div
                v-if="report.closedByAdmin"
                class="mt-2 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-[10px] font-sans font-bold text-amber-800"
                data-testid="zread-closed-by-admin"
            >
                Closed by admin {{ report.closedByName }}
            </div>
        </div>

        <section
            class="space-y-1.5 border-b border-dashed border-slate-300 pb-3 text-[11px]"
        >
            <div
                class="font-sans font-bold text-slate-800 uppercase text-[10px]"
            >
                Sales
            </div>
            <Row label="Transactions" :value="String(report.sales.count)" />
            <Row label="Gross Sales" :value="currency(report.sales.gross)" />
            <Row
                :label="`Discounts Given (${report.sales.discounts.count})`"
                :value="currency(report.sales.discounts.amount)"
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
            class="space-y-1.5 border-b border-dashed border-slate-300 pb-3 text-[11px]"
        >
            <div
                class="font-sans font-bold text-slate-800 uppercase text-[10px]"
            >
                By Tender
            </div>
            <Row
                label="Cash (net of change)"
                :value="currency(report.tenders.cash)"
            />
            <Row label="GCash" :value="currency(report.tenders.gcash)" />
        </section>

        <section
            class="space-y-1.5 border-b border-dashed border-slate-300 pb-3 text-[11px]"
        >
            <div
                class="font-sans font-bold text-slate-800 uppercase text-[10px]"
            >
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
            class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5 text-[11px]"
        >
            <div class="flex justify-between font-bold text-slate-900">
                <span>Physical Cash Counted:</span>
                <span class="text-primary-600">{{
                    currency(report.drawer.countedCash)
                }}</span>
            </div>
            <div
                class="flex justify-between font-black pt-1 border-t border-slate-300"
                :class="varianceClass"
                data-testid="zread-over-short"
            >
                <span>{{ varianceLabel }}:</span>
                <span>{{ signed(report.drawer.overShort) }}</span>
            </div>
        </div>

        <section
            v-if="report.movements.length > 0"
            class="space-y-1 text-[10px] text-slate-600"
        >
            <div
                class="font-sans font-bold text-slate-800 uppercase text-[10px]"
            >
                Drawer Movements
            </div>
            <div
                v-for="(m, i) in report.movements"
                :key="i"
                class="flex justify-between gap-2"
            >
                <span class="truncate"
                    >{{ formatTime(m.at) }} {{ movementLabel(m.type) }} ·
                    {{ m.reason }} ({{ m.byName }})</span
                >
                <span class="shrink-0">{{ currency(m.amount) }}</span>
            </div>
        </section>

        <div class="text-center text-[10px] text-slate-400 font-sans pt-1">
            --- END OF SHIFT CLOSE REPORT ---
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from 'vue';
import { DrawerMovementType, type ZReadReport } from '@grocery-pos/contracts';
import { formatCurrency } from '@/utils/currency';

/** The server's stored Z-read. Every figure is shown as the server sent it. */
const props = defineProps<{ report: ZReadReport }>();

const Row = defineComponent({
    props: {
        label: { type: String, required: true },
        value: { type: String, required: true },
        bold: { type: Boolean, default: false },
    },
    setup(p) {
        return () =>
            h(
                'div',
                {
                    class: [
                        'flex justify-between',
                        p.bold ? 'font-bold text-slate-900' : '',
                    ],
                },
                [
                    h('span', { class: 'text-slate-600' }, `${p.label}:`),
                    h('span', { class: 'font-bold' }, p.value),
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
    if (v === 0) return 'text-emerald-700';
    return v > 0 ? 'text-amber-700' : 'text-rose-700';
});

const MOVEMENT_LABELS: Record<DrawerMovementType, string> = {
    [DrawerMovementType.CASH_IN]: 'Cash in',
    [DrawerMovementType.CASH_DROP]: 'Cash drop',
    [DrawerMovementType.REVERSAL_PAYOUT]: 'Void/refund payout',
};

function movementLabel(type: DrawerMovementType): string {
    return MOVEMENT_LABELS[type] ?? type;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}
</script>
