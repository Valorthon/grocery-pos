<template>
    <header
        class="w-full bg-white border-b border-slate-200/90 shrink-0 z-30 sticky top-0"
    >
        <div
            class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between"
        >
            <!-- Left: brand + tabs -->
            <div class="flex items-center gap-6">
                <button
                    type="button"
                    class="flex items-center gap-2.5 group focus-ring"
                    aria-label="GroceryPOS dashboard"
                    @click="router.push({ name: 'SellerDashboard' })"
                >
                    <div
                        class="w-8 h-8 rounded-lg bg-primary-600/10 text-primary-600 flex items-center justify-center border border-primary-600/20 group-hover:bg-primary-600/20 transition-colors"
                    >
                        <Store class="w-5 h-5" />
                    </div>
                    <span
                        class="text-xl font-extrabold tracking-tight text-primary-600"
                    >
                        GroceryPOS
                    </span>
                </button>

                <nav
                    class="hidden md:flex items-center gap-1 ml-4 pl-4 border-l border-slate-200"
                >
                    <button
                        type="button"
                        class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 focus-ring"
                        :class="
                            isDashboard
                                ? 'bg-slate-100 text-slate-900'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                        "
                        @click="router.push({ name: 'SellerDashboard' })"
                    >
                        <LayoutDashboard class="w-3.5 h-3.5" />
                        <span>Dashboard</span>
                    </button>

                    <button
                        type="button"
                        class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 focus-ring"
                        :class="
                            isOrders
                                ? 'bg-slate-100 text-slate-900'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                        "
                        @click="router.push({ name: 'Sales' })"
                    >
                        <ReceiptText class="w-3.5 h-3.5" />
                        <span>Orders & Sales</span>
                    </button>
                </nav>
            </div>

            <!-- Right: Sell button + profile -->
            <div class="flex items-center gap-3">
                <button
                    type="button"
                    class="px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 transition-all active:scale-[0.98] shadow-xs focus-ring"
                    :class="
                        isRegister
                            ? 'bg-primary-700 text-white ring-2 ring-primary-600/30'
                            : 'bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white'
                    "
                    @click="shiftStore.goToRegister()"
                >
                    <ShoppingCart class="w-4 h-4" />
                    <span>Sell</span>
                    <span
                        v-if="cartCount > 0"
                        class="ml-0.5 bg-white text-primary-600 text-xs font-black px-1.5 py-0.2 rounded-full"
                    >
                        {{ cartCount }}
                    </span>
                </button>

                <UserProfileMenu variant="bar" />
            </div>
        </div>
    </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LayoutDashboard, ReceiptText, ShoppingCart, Store } from '@lucide/vue';
import { useCartStore } from '@/stores/cart';
import { useShiftStore } from '@/stores/shift';
import UserProfileMenu from './UserProfileMenu.vue';

const route = useRoute();
const router = useRouter();
const cartStore = useCartStore();
const shiftStore = useShiftStore();

const cartCount = computed(() => cartStore.totalUnits);
const isDashboard = computed(() => route.name === 'SellerDashboard');
const isOrders = computed(() => route.name === 'Sales');
const isRegister = computed(() => route.name === 'Sell');
</script>
