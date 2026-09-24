<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1
                    class="text-2xl font-extrabold text-slate-900 tracking-tight"
                >
                    Dashboard
                </h1>
                <p class="text-sm text-slate-500 mt-1">
                    Welcome back, {{ authStore.user?.username }}!
                </p>
            </div>
        </div>

        <!-- Stat cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div
                v-for="stat in stats"
                :key="stat.title"
                class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs"
            >
                <div class="flex items-center justify-between mb-4">
                    <div
                        class="w-11 h-11 rounded-xl flex items-center justify-center"
                        :class="stat.avatarClass"
                    >
                        <component :is="stat.icon" :size="22" />
                    </div>
                </div>
                <div class="text-2xl font-extrabold text-slate-900">
                    {{ stat.value }}
                </div>
                <div class="text-xs text-slate-500 mt-1">{{ stat.title }}</div>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Recent sales -->
            <div
                class="md:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"
            >
                <div
                    class="px-5 py-4 border-b border-slate-200 text-sm font-bold text-slate-900"
                >
                    Recent Sales
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr
                                class="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                            >
                                <th class="py-2.5 px-5">Cashier</th>
                                <th class="py-2.5 px-5">Amount</th>
                                <th class="py-2.5 px-5">Payment</th>
                                <th class="py-2.5 px-5">Date</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            <tr v-if="loading">
                                <td colspan="4" class="py-4 text-center">
                                    <Spinner class="mx-auto text-slate-400" />
                                </td>
                            </tr>
                            <tr v-else-if="recentSales.length === 0">
                                <td
                                    colspan="4"
                                    class="py-4 text-center text-slate-400"
                                >
                                    No sales yet
                                </td>
                            </tr>
                            <tr v-for="sale in recentSales" :key="sale._id">
                                <td class="py-3 px-5 font-medium">
                                    {{ sale.cashier?.name ?? 'N/A' }}
                                </td>
                                <td class="py-3 px-5 font-medium">
                                    {{ formatCurrency(sale.amount ?? 0) }}
                                </td>
                                <td class="py-3 px-5">
                                    <Badge
                                        :color="
                                            sale.paymentType === 'CASH'
                                                ? 'success'
                                                : 'info'
                                        "
                                        >{{ sale.paymentType }}</Badge
                                    >
                                    <Badge
                                        v-if="
                                            sale.status &&
                                            sale.status !== 'COMPLETED'
                                        "
                                        color="error"
                                        class="ml-1"
                                        >{{ sale.status }}</Badge
                                    >
                                </td>
                                <td class="py-3 px-5 text-xs text-slate-500">
                                    {{ formatDate(sale.createdAt) }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Recent activity -->
            <div
                class="bg-white rounded-2xl border border-slate-200 shadow-xs p-5"
            >
                <div class="text-sm font-bold text-slate-900 mb-4">
                    Recent Activity
                </div>
                <div v-if="activities.length" class="space-y-4">
                    <div
                        v-for="act in activities"
                        :key="act.id"
                        class="flex gap-3"
                    >
                        <div
                            class="mt-1 w-2 h-2 rounded-full shrink-0"
                            :class="dotClass(act.color)"
                        />
                        <div>
                            <div class="text-sm font-medium text-slate-900">
                                {{ act.title }}
                            </div>
                            <div class="text-xs text-slate-500">
                                {{ act.time }}
                            </div>
                        </div>
                    </div>
                </div>
                <div v-else class="text-slate-400 text-sm">
                    No recent activity
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { AlertCircle, Banknote, Package, ShoppingCart } from '@lucide/vue';
import api from '@/axios';
import Badge from '@/components/ui/Badge.vue';
import Spinner from '@/components/ui/Spinner.vue';
import { useAuthStore } from '@/stores/auth';
import { formatCurrency } from '@/utils/currency';

const authStore = useAuthStore();
const loading = ref(true);

interface DashboardData {
    totalProducts: number;
    lowStockCount: number;
    todaySalesCount: number;
    todayRevenue: number;
    recentSales: Array<{
        _id: string;
        amount: number;
        paymentType: string;
        /** Absent on sales recorded before statuses existed. */
        status?: string;
        createdAt: string;
        cashier?: { name: string };
    }>;
    recentRestocks: Array<{
        _id: string;
        description: string;
        createdAt: string;
        restockedBy?: { name: string };
    }>;
    recentAdjustments: Array<{
        _id: string;
        description: string;
        createdAt: string;
        adjustedBy?: { name: string };
    }>;
}

const data = ref<DashboardData | null>(null);

const stats = computed(() => [
    {
        title: 'Total Products',
        value: data.value?.totalProducts?.toLocaleString() ?? '-',
        icon: Package,
        avatarClass: 'bg-primary-50 text-primary-600',
    },
    {
        title: 'Low Stock Items',
        value: data.value?.lowStockCount?.toLocaleString() ?? '-',
        icon: AlertCircle,
        avatarClass: 'bg-red-50 text-red-600',
    },
    {
        title: "Today's Sales",
        value: data.value?.todaySalesCount?.toLocaleString() ?? '-',
        icon: ShoppingCart,
        avatarClass: 'bg-emerald-50 text-emerald-600',
    },
    {
        title: "Today's Revenue",
        value: formatCurrency(data.value?.todayRevenue ?? 0),
        icon: Banknote,
        avatarClass: 'bg-amber-50 text-amber-600',
    },
]);

const recentSales = computed(() => data.value?.recentSales ?? []);

const activities = computed(() => {
    if (!data.value) return [];
    const items: Array<{
        id: string;
        title: string;
        time: string;
        color: string;
    }> = [];

    data.value.recentSales.forEach((s) => {
        items.push({
            id: `sale-${s._id}`,
            title: `Sale: ${formatCurrency(s.amount ?? 0)}`,
            time: formatRelative(s.createdAt),
            color: 'success',
        });
    });

    data.value.recentRestocks.forEach((r) => {
        items.push({
            id: `restock-${r._id}`,
            title: `Restocked: ${r.description ?? 'Restock'}`,
            time: formatRelative(r.createdAt),
            color: 'info',
        });
    });

    data.value.recentAdjustments.forEach((a) => {
        items.push({
            id: `adjust-${a._id}`,
            title: `Adjusted: ${a.description ?? 'Adjustment'}`,
            time: formatRelative(a.createdAt),
            color: 'warning',
        });
    });

    return items
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        .slice(0, 7);
});

function dotClass(color: string) {
    switch (color) {
        case 'success':
            return 'bg-emerald-500';
        case 'info':
            return 'bg-sky-500';
        case 'warning':
            return 'bg-amber-500';
        default:
            return 'bg-slate-400';
    }
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
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

onMounted(async () => {
    try {
        const res = await api.get('/dashboard');
        data.value = res.data;
    } catch (e) {
        console.error('Dashboard load failed', e);
    } finally {
        loading.value = false;
    }
});
</script>
