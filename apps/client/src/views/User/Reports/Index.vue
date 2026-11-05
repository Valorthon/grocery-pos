<template>
    <PageCard title="Sales reports">
        <template #actions
            ><BaseButton
                :disabled="loading || exporting || !report"
                @click="exportCsv"
                >{{ exporting ? 'Exporting…' : 'Export CSV' }}</BaseButton
            ></template
        >
        <div class="space-y-5 p-5">
            <p class="text-sm text-slate-600">
                Event-date reports: sales use their original time; voids and
                refunds affect the day they happened. Costs use latest-receipt
                estimates.
            </p>
            <p v-if="options" class="text-sm">
                Store timezone: {{ options.timeZone }} · Maximum
                {{ options.maxDays }} days. Weeks start Monday.
            </p>
            <form
                class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                @submit.prevent="apply"
            >
                <BaseSelect
                    id="report-preset"
                    v-model="preset"
                    label="Date preset"
                    :options="
                        REPORT_PRESETS.map((value) => ({ label: value, value }))
                    "
                    @update:model-value="choosePreset"
                />
                <BaseInput
                    id="report-from"
                    v-model="filters.from"
                    type="date"
                    label="From"
                    @input="preset = 'Custom'"
                />
                <BaseInput
                    id="report-to"
                    v-model="filters.to"
                    type="date"
                    label="To (inclusive)"
                    @input="preset = 'Custom'"
                />
                <BaseSelect
                    id="report-group"
                    v-model="filters.groupBy"
                    label="Group by"
                    :options="
                        Object.values(SalesReportGroup).map((value) => ({
                            label: value,
                            value,
                        }))
                    "
                />
                <BaseSelect
                    id="report-cashier"
                    v-model="filters.cashier"
                    label="Cashier"
                    all-label="All cashiers"
                    :options="
                        cashiers.map((row) => ({
                            label: row.name,
                            value: row._id,
                        }))
                    "
                />
                <BaseSelect
                    id="report-payment"
                    v-model="filters.paymentType"
                    label="Payment"
                    all-label="All payments"
                    :options="
                        Object.values(PaymentType).map((value) => ({
                            label: value,
                            value,
                        }))
                    "
                />
                <BaseSelect
                    id="report-category"
                    v-model="filters.category"
                    label="Category"
                    all-label="All categories"
                    :options="
                        categories.map((row) => ({
                            label:
                                row.name + (row.isActive ? '' : ' (archived)'),
                            value: row._id,
                        }))
                    "
                />
                <BaseButton type="submit" :disabled="loading || !options">{{
                    loading ? 'Loading…' : 'Run report'
                }}</BaseButton>
            </form>
            <p v-if="filterError" role="alert" class="text-sm text-red-700">
                {{ filterError }}
                <BaseButton variant="outline" @click="refreshFilters"
                    >Retry filters</BaseButton
                >
            </p>
            <p v-if="error" role="alert" class="text-sm text-red-700">
                {{ error }}
                <BaseButton variant="outline" :disabled="loading" @click="retry"
                    >Retry report</BaseButton
                >
            </p>
            <p v-if="exportError" role="alert" class="text-sm text-red-700">
                {{ exportError }}
            </p>
            <template v-if="report">
                <p class="text-sm font-semibold" data-testid="report-applied">
                    {{ report.from }} through {{ report.to }} ·
                    {{ report.groupBy }} · {{ report.timeZone }}
                </p>
                <div class="grid gap-3 sm:grid-cols-3">
                    <div class="rounded-xl border border-slate-200 p-3">
                        <p class="text-sm">Net sales</p>
                        <p class="text-xl font-bold">
                            {{ formatCurrency(report.totals.netSales) }}
                        </p>
                    </div>
                    <div class="rounded-xl border border-slate-200 p-3">
                        <p class="text-sm">Known COGS · latest receipt</p>
                        <p class="text-xl font-bold">
                            {{ formatCurrency(report.totals.knownCogs) }}
                        </p>
                    </div>
                    <div class="rounded-xl border border-slate-200 p-3">
                        <p class="text-sm">Gross margin estimate</p>
                        <p class="text-xl font-bold">
                            {{
                                report.totals.grossMargin === null
                                    ? 'Incomplete cost coverage'
                                    : formatCurrency(report.totals.grossMargin)
                            }}
                        </p>
                    </div>
                </div>
                <p class="text-sm" data-testid="cost-coverage">
                    {{ report.totals.knownCostLines }} known-cost /
                    {{ report.totals.unknownCostLines }} unknown-cost event
                    lines.
                    <span v-if="!report.totals.costCoverageComplete"
                        >Known-cost portion margin:
                        {{ formatCurrency(report.totals.knownGrossMargin) }}.
                        Missing costs are not zero.</span
                    >
                </p>
                <svg
                    v-if="
                        report.groupBy === SalesReportGroup.DAY && chartPoints
                    "
                    viewBox="0 0 600 180"
                    role="img"
                    aria-label="Daily net sales trend"
                    class="h-48 w-full rounded-xl border border-slate-200 bg-slate-50"
                >
                    <line
                        x1="10"
                        :y1="chartZero"
                        x2="590"
                        :y2="chartZero"
                        stroke="gray"
                    />
                    <polyline
                        :points="chartPoints"
                        fill="none"
                        stroke="teal"
                        stroke-width="3"
                    />
                </svg>
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm">
                        <caption class="pb-2 text-left">
                            All amounts are pesos. Quantities remain separated
                            by unit. A transaction can appear in several
                            product/category groups; totals count it once.
                        </caption>
                        <thead>
                            <tr>
                                <th>Group</th>
                                <th>Sales / reversals</th>
                                <th>Quantity (net)</th>
                                <th>Gross</th>
                                <th>Discounts</th>
                                <th>Voids</th>
                                <th>Refunds</th>
                                <th>Net</th>
                                <th>Known COGS</th>
                                <th>Margin estimate</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="row in report.rows"
                                :key="row.key"
                                class="border-t border-slate-200"
                            >
                                <th class="py-3">{{ row.label }}</th>
                                <td>
                                    {{ row.transactions }} /
                                    {{ row.reversalTransactions }}
                                </td>
                                <td>
                                    {{
                                        row.quantities
                                            .map((q) =>
                                                formatQuantity(q.net, q.unit),
                                            )
                                            .join(', ')
                                    }}
                                </td>
                                <td>{{ formatCurrency(row.grossSales) }}</td>
                                <td>{{ formatCurrency(row.discounts) }}</td>
                                <td>{{ formatCurrency(row.voids) }}</td>
                                <td>{{ formatCurrency(row.refunds) }}</td>
                                <td>{{ formatCurrency(row.netSales) }}</td>
                                <td>{{ formatCurrency(row.knownCogs) }}</td>
                                <td>
                                    {{
                                        row.grossMargin === null
                                            ? 'Incomplete'
                                            : formatCurrency(row.grossMargin)
                                    }}
                                </td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr class="border-t-2 border-slate-300 font-bold">
                                <th class="py-3">Total</th>
                                <td>
                                    {{ report.totals.transactions }} /
                                    {{ report.totals.reversalTransactions }}
                                </td>
                                <td>
                                    {{
                                        report.totals.quantities
                                            .map((q) =>
                                                formatQuantity(q.net, q.unit),
                                            )
                                            .join(', ')
                                    }}
                                </td>
                                <td>
                                    {{
                                        formatCurrency(report.totals.grossSales)
                                    }}
                                </td>
                                <td>
                                    {{
                                        formatCurrency(report.totals.discounts)
                                    }}
                                </td>
                                <td>
                                    {{ formatCurrency(report.totals.voids) }}
                                </td>
                                <td>
                                    {{ formatCurrency(report.totals.refunds) }}
                                </td>
                                <td>
                                    {{ formatCurrency(report.totals.netSales) }}
                                </td>
                                <td>
                                    {{
                                        formatCurrency(report.totals.knownCogs)
                                    }}
                                </td>
                                <td>
                                    {{
                                        report.totals.grossMargin === null
                                            ? 'Incomplete'
                                            : formatCurrency(
                                                  report.totals.grossMargin,
                                              )
                                    }}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                    <p v-if="!report.rows.length" class="py-4 text-sm">
                        No matching sales or reversal events.
                    </p>
                </div>
                <details class="rounded-xl border border-slate-200 p-3 text-sm">
                    <summary class="cursor-pointer font-bold">
                        Reconcile with shift Z-reads
                    </summary>
                    <p class="mt-2">{{ report.reconciliation.note }}</p>
                    <p>
                        Original charged sales:
                        {{ formatCurrency(report.reconciliation.chargedSales) }}
                        · reversal events:
                        {{
                            formatCurrency(
                                report.reconciliation.reversalAmount,
                            )
                        }}.
                    </p>
                    <p>
                        Prior-period reversals:
                        {{ report.reconciliation.priorPeriodReversals }} ({{
                            formatCurrency(
                                report.reconciliation.priorPeriodReversalAmount,
                            )
                        }}). Late offline occurrences:
                        {{ report.reconciliation.lateOfflineTransactions }} ({{
                            formatCurrency(
                                report.reconciliation.lateOfflineNetSales,
                            )
                        }}).
                    </p>
                    <RouterLink
                        :to="{ name: 'Shifts' }"
                        class="font-bold text-primary-700 underline"
                        >Review original Z-reads and late addenda</RouterLink
                    >
                </details>
            </template>
        </div>
    </PageCard>
</template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import { isAxiosError } from 'axios';
import { RouterLink } from 'vue-router';
import {
    PaymentType,
    REPORT_LIMITS,
    SalesReportGroup,
    formatQuantity,
    type SalesReport,
    type ReportOptions,
} from '@grocery-pos/contracts';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { apiErrorText } from '@/utils/api-error';
import { formatCurrency } from '@/utils/currency';
import { useSalesLookups } from '@/composables/useSalesLookups';
import { presetRange, REPORT_PRESETS, type ReportPreset } from './presets';

const {
    categories,
    cashiers,
    error: filterError,
    refresh: refreshFilters,
} = useSalesLookups();
const options = ref<ReportOptions | null>(null);
const preset = ref<ReportPreset>('Today');
const filters = reactive({
    from: '',
    to: '',
    groupBy: SalesReportGroup.DAY,
    cashier: null as string | null,
    category: null as string | null,
    paymentType: null as string | null,
});
type Query = {
    from: string;
    to: string;
    groupBy: SalesReportGroup;
    cashier?: string;
    category?: string;
    paymentType?: string;
};
const applied = ref<Query | null>(null);
const requested = ref<Query | null>(null);
const report = ref<SalesReport | null>(null);
const loading = ref(false);
const exporting = ref(false);
const error = ref('');
const exportError = ref('');
let generation = 0;
let alive = true;
function choosePreset() {
    const range = options.value
        ? presetRange(preset.value, options.value.today)
        : null;
    if (range) Object.assign(filters, range);
}
function requestFilters(): Query {
    return {
        from: filters.from,
        to: filters.to,
        groupBy: filters.groupBy,
        ...(filters.cashier ? { cashier: filters.cashier } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.paymentType ? { paymentType: filters.paymentType } : {}),
    };
}
async function load(query: Query) {
    requested.value = { ...query };
    const turn = ++generation;
    loading.value = true;
    error.value = '';
    try {
        const { data } = await api.get<SalesReport>('/reports/sales', {
            params: query,
        });
        if (alive && turn === generation) {
            report.value = data;
            applied.value = { ...query };
        }
    } catch (cause) {
        if (alive && turn === generation)
            error.value = apiErrorText(cause, 'Could not load sales report.');
    } finally {
        if (alive && turn === generation) loading.value = false;
    }
}
function apply() {
    const from = Date.parse(filters.from);
    const to = Date.parse(filters.to);
    if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        to < from ||
        (to - from) / 86400000 + 1 > REPORT_LIMITS.DAYS_MAX
    ) {
        error.value = `Choose a valid inclusive range of at most ${REPORT_LIMITS.DAYS_MAX} days.`;
        return;
    }
    void load(requestFilters());
}
async function initialize() {
    const turn = ++generation;
    loading.value = true;
    error.value = '';
    try {
        const { data } = await api.get<ReportOptions>('/reports/options');
        if (!alive || turn !== generation) return;
        options.value = data;
        choosePreset();
        apply();
    } catch (cause) {
        if (alive && turn === generation) {
            error.value = apiErrorText(
                cause,
                'Could not load report settings.',
            );
            loading.value = false;
        }
    }
}
function retry() {
    if (!options.value) void initialize();
    else if (requested.value) void load({ ...requested.value });
    else apply();
}
async function exportCsv() {
    if (!applied.value || exporting.value) return;
    exporting.value = true;
    exportError.value = '';
    const query = { ...applied.value };
    try {
        const { data } = await api.get<Blob>('/reports/sales.csv', {
            params: query,
            responseType: 'blob',
        });
        if (!alive) return;
        const url = URL.createObjectURL(data);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `sales-${query.from}-${query.to}-${query.groupBy}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
    } catch (cause) {
        if (isAxiosError(cause) && cause.response?.data instanceof Blob) {
            try {
                cause.response.data = JSON.parse(
                    await cause.response.data.text(),
                ) as unknown;
            } catch {
                /* Fall back to fixed error text. */
            }
        }
        if (alive)
            exportError.value = apiErrorText(
                cause,
                'Could not export sales report.',
            );
    } finally {
        if (alive) exporting.value = false;
    }
}
const chartBounds = computed(() => {
    const values = report.value?.rows.map((row) => row.netSales) ?? [];
    return { min: Math.min(0, ...values), max: Math.max(0, ...values, 1) };
});
const chartZero = computed(
    () =>
        170 -
        ((0 - chartBounds.value.min) /
            (chartBounds.value.max - chartBounds.value.min)) *
            160,
);
const chartPoints = computed(() => {
    const rows = report.value?.rows ?? [];
    return rows
        .map(
            (row, index) =>
                `${rows.length === 1 ? 300 : 10 + (index / (rows.length - 1)) * 580},${170 - ((row.netSales - chartBounds.value.min) / (chartBounds.value.max - chartBounds.value.min)) * 160}`,
        )
        .join(' ');
});
onMounted(() => void initialize());
onBeforeUnmount(() => {
    alive = false;
    generation++;
});
</script>
