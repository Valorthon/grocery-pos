<template>
    <PageFrame
        :description="`Welcome back, ${authStore.user?.username ?? ''}!`"
    >
        <div
            v-if="loadError"
            role="alert"
            data-testid="dashboard-error"
            class="flex flex-wrap items-center gap-3 rounded-card border border-danger-border bg-danger-bg px-5 py-4 text-sm text-danger-fg"
        >
            <AlertCircle :size="18" class="shrink-0" aria-hidden="true" />
            <p class="flex-1 font-bold">
                The dashboard could not be loaded: {{ loadError }}
            </p>
            <BaseButton
                variant="outline"
                size="sm"
                :loading="loading"
                @click="loadDashboard"
            >
                <RotateCw class="w-4 h-4" />
                Retry
            </BaseButton>
        </div>

        <!--
            Stat tiles in two sections (#212), keyed by `stat.key`, never by
            their titles. Needs attention shows only for the roles with a say
            over items (canOpenInventory); USER_MANAGER sees Overview only.
        -->
        <section
            v-for="section in sections"
            :key="section.key"
            :data-section="section.key"
            :aria-labelledby="`dashboard-${section.key}-title`"
            class="flex flex-col gap-3"
        >
            <h2
                :id="`dashboard-${section.key}-title`"
                class="font-display text-base font-bold text-ink"
            >
                {{ section.title }}
            </h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                <StatTile
                    v-for="stat in section.stats"
                    :key="stat.key"
                    :data-stat="stat.key"
                    :label="stat.title"
                    :value="stat.value"
                    :tone="stat.tone"
                    :to="stat.to"
                    :loading="tilesLoading"
                >
                    <template #icon>
                        <component :is="stat.icon" :size="18" />
                    </template>
                </StatTile>
            </div>
        </section>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <p v-if="showsMoney" class="text-sm text-muted md:col-span-3">
                Today's dashboard totals use original sale-day amounts and
                exclude sales now reversed. Sales Reports use event dates: later
                voids/refunds affect their own day.
            </p>
            <!-- Recent sales: ADMIN only, absent from the API otherwise -->
            <section
                v-if="showsSalesTable"
                data-testid="recent-sales"
                aria-labelledby="recent-sales-title"
                class="md:col-span-2 flex flex-col gap-3"
            >
                <div class="flex items-center justify-between gap-2">
                    <h2
                        id="recent-sales-title"
                        class="font-display text-base font-bold text-ink"
                    >
                        Recent Sales
                    </h2>
                    <RouterLink
                        v-if="hasRouter"
                        :to="{ name: 'SalesHistory' }"
                        data-testid="recent-sales-all"
                        class="inline-flex min-h-11 items-center rounded-control px-2 text-sm font-semibold text-leaf-700 hover:underline focus-ring"
                    >
                        View all sales
                    </RouterLink>
                </div>
                <BaseTable
                    :headers="saleHeaders"
                    :items="saleRows"
                    :loading="loading && !data"
                    :skeleton-rows="5"
                    empty-text="No sales yet"
                    @retry="loadDashboard"
                >
                    <template #cell-cashier="{ item }">
                        <span class="font-medium">{{ item.cashier }}</span>
                    </template>
                    <template #cell-amount="{ item }">
                        <span class="font-display num font-semibold">{{
                            item.amount
                        }}</span>
                    </template>
                    <template #cell-paymentType="{ item }">
                        <Badge
                            :color="
                                item.paymentType === PaymentType.CASH
                                    ? 'success'
                                    : 'info'
                            "
                            >{{ item.paymentType }}</Badge
                        >
                        <Badge
                            v-if="
                                item.status &&
                                item.status !== SaleStatus.COMPLETED
                            "
                            color="error"
                            class="ml-1"
                            >{{ item.status }}</Badge
                        >
                    </template>
                    <template #cell-createdAt="{ item }">
                        <span class="text-xs text-muted">{{
                            item.createdAt
                        }}</span>
                    </template>
                </BaseTable>
            </section>

            <!-- Recent activity -->
            <section
                :class="showsSalesTable ? '' : 'md:col-span-3'"
                aria-labelledby="recent-activity-title"
                class="rounded-card border border-line bg-surface p-5 shadow-card"
            >
                <h2
                    id="recent-activity-title"
                    class="font-display mb-4 text-base font-bold text-ink"
                >
                    Recent Activity
                </h2>
                <div v-if="activities.length" class="space-y-4">
                    <div
                        v-for="act in activities"
                        :key="act.id"
                        data-testid="activity"
                        class="flex gap-3"
                    >
                        <div
                            class="mt-1 w-2 h-2 rounded-full shrink-0"
                            :class="dotClass(act.color)"
                        />
                        <div>
                            <div class="text-sm font-medium text-ink">
                                {{ act.title }}
                            </div>
                            <div class="text-xs text-muted">
                                {{ act.time }}
                            </div>
                        </div>
                    </div>
                </div>
                <div
                    v-else-if="loading"
                    class="space-y-4"
                    aria-busy="true"
                    data-skeleton
                >
                    <span class="sr-only">Loading</span>
                    <div
                        v-for="i in 3"
                        :key="i"
                        class="h-8 animate-pulse rounded-control bg-line"
                    />
                </div>
                <p v-else-if="!data" class="text-sm text-muted">Unavailable</p>
                <EmptyState v-else title="No recent activity" />
            </section>
        </div>
    </PageFrame>
</template>

<script setup lang="ts">
import PageFrame from '@/components/ui/PageFrame.vue';
import { ref, computed, inject, type Component } from 'vue';
import {
    AlertCircle,
    Banknote,
    Package,
    PackageX,
    RotateCw,
    ShoppingCart,
} from '@lucide/vue';
import api from '@/axios';
import Badge from '@/components/ui/Badge.vue';
import StatTile from '@/components/ui/StatTile.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import type { TableHeader } from '@/components/ui/types';
import { RouterLink, routerKey, type RouteLocationRaw } from 'vue-router';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useListFetch } from '@/composables/useListFetch';
import { useAuthStore, Role } from '@/stores/auth';
import { formatCurrency } from '@/utils/currency';
import { formatStoreDateTime } from '@/utils/datetime';
import {
    type DashboardView,
    PaymentType,
    SaleStatus,
} from '@grocery-pos/contracts';

const authStore = useAuthStore();
const canOpenInventory = computed(
    () =>
        authStore.isAdmin ||
        authStore.hasRole(Role.Restocker) ||
        authStore.hasRole(Role.Adjuster),
);

/**
 * GET /dashboard (contracts `DashboardView`). `todayRevenue` and
 * `recentSales` are money figures the API returns to ADMIN only (issue
 * #13); for other management roles they are absent and their tiles are
 * not shown.
 */
const data = ref<DashboardView | null>(null);

/** Whether the API sent money figures, i.e. the caller is an ADMIN. */
const showsMoney = computed(() => data.value?.todayRevenue !== undefined);

type StatKey =
    | 'expiring'
    | 'products'
    | 'lowStock'
    | 'outOfStock'
    | 'todaySales'
    | 'todayRevenue';

interface Stat {
    key: StatKey;
    title: string;
    value: string;
    icon: Component;
    tone: 'neutral' | 'warning' | 'danger';
    /** Only for roles that may open the list behind the tile. */
    to?: RouteLocationRaw;
}

/** Tests mount the view without a router: no links then. */
const hasRouter = inject(routerKey, null) !== null;

function count(n: number | undefined): string {
    return n === undefined ? '-' : n.toLocaleString();
}

/** Warning or danger only while something needs attention. */
function attention(
    n: number | undefined,
    tone: 'warning' | 'danger',
): Stat['tone'] {
    return n !== undefined && n > 0 ? tone : 'neutral';
}

/** Where each tile's list lives, for the roles that may open it. */
const tileLinks = computed<Partial<Record<StatKey, RouteLocationRaw>>>(() =>
    hasRouter && canOpenInventory.value
        ? {
              expiring: { name: 'Inventories', query: { expiring: 'true' } },
              lowStock: { name: 'Inventories', query: { lowStock: 'true' } },
              outOfStock: {
                  name: 'Inventories',
                  query: { outOfStock: 'true' },
              },
          }
        : {},
);

const attentionStats = computed<Stat[]>(() => {
    const d = data.value;
    return [
        {
            key: 'expiring',
            title: 'Expiring / expired batches',
            value: count(d?.expiringBatchCount),
            icon: AlertCircle,
            tone: attention(d?.expiringBatchCount, 'warning'),
        },
        {
            key: 'lowStock',
            title: 'Low Stock Items',
            value: count(d?.lowStockCount),
            icon: AlertCircle,
            tone: attention(d?.lowStockCount, 'warning'),
        },
        {
            key: 'outOfStock',
            title: 'Out of Stock Items',
            value: count(d?.outOfStockCount),
            icon: PackageX,
            tone: attention(d?.outOfStockCount, 'danger'),
        },
    ];
});

const overviewStats = computed<Stat[]>(() => {
    const d = data.value;
    const list: Stat[] = [
        {
            key: 'products',
            title: 'Total Products',
            value: count(d?.totalProducts),
            icon: Package,
            tone: 'neutral',
        },
        {
            key: 'todaySales',
            title: "Today's Sales",
            value: count(d?.todaySalesCount),
            icon: ShoppingCart,
            tone: 'neutral',
        },
    ];
    // An ADMIN's revenue skeleton holds its place during the first load,
    // so the grid does not reflow; no figure shows before the answer.
    if (showsMoney.value || (!d && authStore.isAdmin && loading.value)) {
        list.push({
            key: 'todayRevenue',
            title: "Today's Revenue",
            value: formatCurrency(d?.todayRevenue ?? 0),
            icon: Banknote,
            tone: 'neutral',
        });
    }
    return list;
});

interface Section {
    key: 'attention' | 'overview';
    title: string;
    stats: Stat[];
}

/** Needs attention first, for the roles that manage items; then Overview. */
const sections = computed<Section[]>(() => {
    const withLinks = (list: Stat[]) =>
        list.map((stat) => ({ ...stat, to: tileLinks.value[stat.key] }));
    const list: Section[] = [];
    if (canOpenInventory.value)
        list.push({
            key: 'attention',
            title: 'Needs attention',
            stats: withLinks(attentionStats.value),
        });
    list.push({
        key: 'overview',
        title: 'Overview',
        stats: withLinks(overviewStats.value),
    });
    return list;
});

/** Skeletons until the first answer; a reload keeps the last figures. */
const tilesLoading = computed(() => loading.value && !data.value);

/**
 * The sales table shows for an ADMIN while the first load runs (its
 * skeleton), then exactly when the API sent money figures. A failed
 * load has one error and Retry: the page banner.
 */
const showsSalesTable = computed(() =>
    data.value ? showsMoney.value : authStore.isAdmin && loading.value,
);

const saleHeaders: TableHeader[] = [
    { key: 'cashier', title: 'Cashier' },
    { key: 'amount', title: 'Amount', align: 'right' },
    { key: 'paymentType', title: 'Payment' },
    { key: 'createdAt', title: 'Date' },
];

const saleRows = computed(() =>
    recentSales.value.map((sale) => ({
        id: sale._id,
        cashier: sale.cashier?.name ?? 'N/A',
        amount: formatCurrency(sale.amount ?? 0),
        paymentType: sale.paymentType,
        status: sale.status,
        createdAt: formatDate(sale.createdAt),
    })),
);

const recentSales = computed(() => data.value?.recentSales ?? []);

/**
 * The newest sales, restocks and adjustments together, newest first
 * (issue #20): sorted on the raw timestamps, then cut to 7, and only then
 * formatted as "5 min ago".
 */
const activities = computed(() => {
    if (!data.value) return [];
    const items: Array<{
        id: string;
        title: string;
        createdAt: string;
        at: number;
        color: string;
    }> = [];

    (data.value.recentSales ?? []).forEach((s) => {
        items.push({
            id: `sale-${s._id}`,
            title: `Sale: ${formatCurrency(s.amount ?? 0)}`,
            createdAt: s.createdAt,
            at: timestamp(s.createdAt),
            color: 'success',
        });
    });

    data.value.recentRestocks.forEach((r) => {
        items.push({
            id: `restock-${r._id}`,
            title: `Restocked: ${r.description ?? 'Restock'}`,
            createdAt: r.createdAt,
            at: timestamp(r.createdAt),
            color: 'info',
        });
    });

    data.value.recentAdjustments.forEach((a) => {
        items.push({
            id: `adjust-${a._id}`,
            title: `Adjusted: ${a.description ?? 'Adjustment'}`,
            createdAt: a.createdAt,
            at: timestamp(a.createdAt),
            color: 'warning',
        });
    });

    return items
        .sort((a, b) => b.at - a.at)
        .slice(0, 7)
        .map(({ id, title, color, createdAt }) => ({
            id,
            title,
            color,
            time: formatRelative(createdAt),
        }));
});

/** Milliseconds since the epoch; an unreadable date sorts last. */
function timestamp(iso: string): number {
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? 0 : ms;
}

function dotClass(color: string) {
    switch (color) {
        case 'success':
            return 'bg-success-fg';
        case 'info':
            return 'bg-info-fg';
        case 'warning':
            return 'bg-warning-fg';
        default:
            return 'bg-line-strong';
    }
}

function formatDate(iso: string) {
    return formatStoreDateTime(iso);
}

function formatRelative(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

/**
 * A failure shows an error banner with Retry (issue #18); the tiles keep
 * their last figures, or "-" when there are none.
 */
const {
    loading,
    error: loadError,
    load: loadDashboard,
} = useListFetch(
    () => api.get<DashboardView>('/dashboard'),
    (res) => {
        data.value = res.data;
    },
    'Please try again.',
);

void loadDashboard();
</script>
