<template>
    <v-container fluid class="pa-6">
        <!-- Header -->
        <div class="d-flex align-center justify-space-between mb-8">
            <div>
                <h1 class="text-h5 font-weight-bold text-grey-darken-4">
                    Dashboard
                </h1>
                <p class="text-body-2 text-medium-emphasis mt-1">
                    Welcome back, {{ authStore.user?.username }} 👋
                </p>
            </div>
            <v-btn
                v-if="canSell"
                color="primary"
                rounded="lg"
                variant="flat"
                elevation="0"
                :to="{ name: 'Sell' }"
            >
                <v-icon start>mdi-cart-plus</v-icon>
                New Sale
            </v-btn>
        </div>

        <!-- Stat Cards -->
        <v-row class="mb-6">
            <v-col
                v-for="stat in stats"
                :key="stat.title"
                cols="12"
                sm="6"
                xl="3"
            >
                <v-card
                    rounded="xl"
                    elevation="0"
                    border
                    class="pa-5"
                    style="transition: transform 0.2s ease"
                >
                    <div class="d-flex align-center justify-space-between mb-4">
                        <v-avatar
                            size="44"
                            rounded="lg"
                            :color="stat.avatarColor"
                            variant="tonal"
                        >
                            <v-icon :color="stat.color" size="22">{{
                                stat.icon
                            }}</v-icon>
                        </v-avatar>
                    </div>
                    <div class="text-h5 font-weight-bold mb-1">
                        {{ stat.value }}
                    </div>
                    <div class="text-caption text-medium-emphasis">
                        {{ stat.title }}
                    </div>
                </v-card>
            </v-col>
        </v-row>

        <!-- Recent Sales + Activity -->
        <v-row>
            <!-- Recent Sales Table -->
            <v-col cols="12" md="8">
                <v-card rounded="xl" elevation="0" border>
                    <v-card-title
                        class="pa-5 pb-0 text-subtitle-1 font-weight-bold"
                    >
                        Recent Sales
                    </v-card-title>
                    <v-table density="comfortable">
                        <thead>
                            <tr>
                                <th class="text-left">Cashier</th>
                                <th class="text-left">Amount</th>
                                <th class="text-left">Payment</th>
                                <th class="text-left">Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="loading">
                                <td colspan="4" class="text-center py-4">
                                    <v-progress-circular
                                        indeterminate
                                        size="24"
                                    />
                                </td>
                            </tr>
                            <tr v-else-if="recentSales.length === 0">
                                <td
                                    colspan="4"
                                    class="text-center py-4 text-grey-darken-1"
                                >
                                    No sales yet
                                </td>
                            </tr>
                            <tr v-for="sale in recentSales" :key="sale._id">
                                <td class="text-body-2 font-weight-medium">
                                    {{ sale.cashier?.name ?? 'N/A' }}
                                </td>
                                <td class="font-weight-medium text-body-2">
                                    ₱{{ sale.amount?.toLocaleString() ?? 0 }}
                                </td>
                                <td>
                                    <v-chip
                                        :color="
                                            sale.paymentType === 'CASH'
                                                ? 'success'
                                                : 'info'
                                        "
                                        size="x-small"
                                        variant="tonal"
                                    >
                                        {{ sale.paymentType }}
                                    </v-chip>
                                </td>
                                <td class="text-caption text-medium-emphasis">
                                    {{ formatDate(sale.createdAt) }}
                                </td>
                            </tr>
                        </tbody>
                    </v-table>
                </v-card>
            </v-col>

            <!-- Recent Activity Timeline -->
            <v-col cols="12" md="4">
                <v-card rounded="xl" elevation="0" border class="pa-5">
                    <div class="text-subtitle-1 font-weight-bold mb-4">
                        Recent Activity
                    </div>
                    <v-timeline
                        v-if="activities.length"
                        density="compact"
                        align="start"
                        side="end"
                        truncate-line="both"
                    >
                        <v-timeline-item
                            v-for="act in activities"
                            :key="act.id"
                            :dot-color="act.color"
                            size="small"
                        >
                            <div class="text-body-2 font-weight-medium">
                                {{ act.title }}
                            </div>
                            <div class="text-caption text-medium-emphasis">
                                {{ act.time }}
                            </div>
                        </v-timeline-item>
                    </v-timeline>
                    <div v-else class="text-grey-darken-1 text-body-2">
                        No recent activity
                    </div>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAuthStore, Role } from '@/stores/auth';
import api from '@/axios';

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

const canSell = computed(
    () => authStore.hasRole(Role.Seller) || authStore.isAdmin,
);

const stats = computed(() => [
    {
        title: 'Total Products',
        value: data.value?.totalProducts?.toLocaleString() ?? '-',
        icon: 'mdi-package-variant-closed',
        color: 'primary',
        avatarColor: 'primary',
    },
    {
        title: 'Low Stock Items',
        value: data.value?.lowStockCount?.toLocaleString() ?? '-',
        icon: 'mdi-alert-circle-outline',
        color: 'error',
        avatarColor: 'error',
    },
    {
        title: "Today's Sales",
        value: data.value?.todaySalesCount?.toLocaleString() ?? '-',
        icon: 'mdi-cart-outline',
        color: 'success',
        avatarColor: 'success',
    },
    {
        title: "Today's Revenue",
        value: `₱${(data.value?.todayRevenue ?? 0).toLocaleString()}`,
        icon: 'mdi-currency-php',
        color: 'warning',
        avatarColor: 'warning',
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
            title: `Sale: ₱${s.amount?.toLocaleString() ?? 0}`,
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
