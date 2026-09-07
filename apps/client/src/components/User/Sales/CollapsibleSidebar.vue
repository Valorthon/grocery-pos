<template>
    <aside
        class="bg-white border-r border-slate-200/90 h-screen flex flex-col justify-between shrink-0 transition-[width] duration-300 z-30 select-none"
        :class="isCollapsed ? 'w-20' : 'w-64'"
    >
        <div class="overflow-hidden">
            <!-- Brand + collapse toggle -->
            <div
                class="h-16 flex items-center border-b border-slate-100 px-4"
                :class="isCollapsed ? 'justify-center' : 'justify-between'"
            >
                <div
                    v-if="!isCollapsed"
                    class="flex items-center justify-between w-full"
                >
                    <div class="shrink-0 whitespace-nowrap">
                        <span
                            class="text-base font-extrabold tracking-tight text-slate-900 leading-tight block"
                        >
                            GroceryPOS
                        </span>
                        <span
                            class="text-[10px] text-slate-400 font-bold uppercase tracking-wider block"
                        >
                            Lane #1 Terminal
                        </span>
                    </div>

                    <button
                        type="button"
                        class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                        @click="isCollapsed = !isCollapsed"
                    >
                        <PanelLeftClose class="w-4 h-4" />
                    </button>
                </div>

                <button
                    v-else
                    type="button"
                    class="w-10 h-10 rounded-xl bg-primary-600/10 text-primary-600 hover:bg-primary-600 hover:text-white flex items-center justify-center border border-primary-600/20 hover:border-primary-600 transition-all duration-200 group relative"
                    @click="isCollapsed = !isCollapsed"
                >
                    <Store class="w-5 h-5 group-hover:hidden" />
                    <PanelLeft class="w-5 h-5 hidden group-hover:block" />
                </button>
            </div>

            <!-- Nav items -->
            <nav class="p-3 space-y-1.5">
                <button
                    v-for="item in navItems"
                    :key="item.id"
                    type="button"
                    class="w-full flex items-center rounded-xl transition-all group relative"
                    :class="[
                        isCollapsed
                            ? 'justify-center p-3'
                            : 'justify-between px-3.5 py-3',
                        isActive(item.id)
                            ? 'bg-primary-600 text-white font-bold shadow-xs'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-semibold',
                    ]"
                    :title="isCollapsed ? item.label : undefined"
                    @click="handleClick(item)"
                >
                    <div class="flex items-center gap-3 shrink-0">
                        <component
                            :is="item.icon"
                            class="w-5 h-5 shrink-0"
                            :class="
                                isActive(item.id)
                                    ? 'text-white'
                                    : 'text-slate-500 group-hover:text-slate-900'
                            "
                        />
                        <span
                            v-if="!isCollapsed"
                            class="text-xs sm:text-sm block whitespace-nowrap"
                        >
                            {{ item.label }}
                        </span>
                    </div>

                    <span
                        v-if="item.id === 'register' && cartCount > 0"
                        class="text-[10px] font-black px-2 py-0.5 rounded-full"
                        :class="
                            isActive(item.id)
                                ? 'bg-white text-primary-600'
                                : 'bg-primary-600 text-white'
                        "
                    >
                        {{ cartCount }}
                    </span>
                </button>
            </nav>
        </div>

        <div class="p-3 border-t border-slate-200/80">
            <UserProfileMenu :variant="isCollapsed ? 'icon' : 'box'" />
        </div>
    </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
    LayoutDashboard,
    PanelLeft,
    PanelLeftClose,
    ReceiptText,
    ShoppingCart,
    Store,
} from '@lucide/vue';
import { useCartStore } from '@/stores/cart';
import { useShiftStore } from '@/stores/shift';
import UserProfileMenu from './UserProfileMenu.vue';

const router = useRouter();
const cartStore = useCartStore();
const shiftStore = useShiftStore();

const isCollapsed = ref(true);
const cartCount = computed(() => cartStore.totalUnits);

const navItems = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        route: 'SellerDashboard',
    },
    {
        id: 'register',
        label: 'Register (Sale)',
        icon: ShoppingCart,
        route: 'Sell',
    },
    { id: 'orders', label: 'Sales History', icon: ReceiptText, route: 'Sales' },
];

function isActive(id: string) {
    switch (id) {
        case 'dashboard':
            return router.currentRoute.value.name === 'SellerDashboard';
        case 'register':
            return router.currentRoute.value.name === 'Sell';
        case 'orders':
            return router.currentRoute.value.name === 'Sales';
        default:
            return false;
    }
}

function handleClick(item: { id: string; route: string }) {
    if (item.id === 'register') {
        shiftStore.goToRegister();
        return;
    }
    router.push({ name: item.route });
}
</script>
