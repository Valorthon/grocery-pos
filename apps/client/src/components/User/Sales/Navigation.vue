<template>
    <header
        class="w-full bg-white border-b border-slate-200/90 shrink-0 z-30 sticky top-0"
    >
        <div
            class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between"
        >
            <!-- Left: menu (below md) + brand + tabs -->
            <div class="flex items-center gap-2 sm:gap-6">
                <!-- Below md the tabs are in a drawer (#89): its menu button. -->
                <button
                    type="button"
                    class="md:hidden min-h-11 min-w-11 -ml-2 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors focus-ring"
                    aria-label="Open navigation menu"
                    aria-controls="seller-nav-drawer"
                    :aria-expanded="drawerOpen"
                    data-testid="seller-nav-menu"
                    @click="menuOpen = true"
                >
                    <Menu class="w-6 h-6" aria-hidden="true" />
                </button>

                <button
                    type="button"
                    class="min-h-11 min-w-11 flex items-center gap-2.5 group focus-ring"
                    aria-label="GroceryPOS dashboard"
                    @click="router.push({ name: 'SellerDashboard' })"
                >
                    <div
                        class="w-8 h-8 rounded-lg bg-primary-600/10 text-primary-600 flex items-center justify-center border border-primary-600/20 group-hover:bg-primary-600/20 transition-colors"
                    >
                        <Store class="w-5 h-5" />
                    </div>
                    <span
                        class="text-xl font-extrabold tracking-tight text-primary-600 hidden sm:inline"
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
                    class="min-h-11 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 transition-all active:scale-[0.98] shadow-xs focus-ring"
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

        <!--
            The mobile menu (#89): a drawer on the modal stack, under <body>,
            so the dashboard behind it is inert. The backdrop, its X, Escape
            and any navigation close it; so does growing to md, where the
            tabs show again.
        -->
        <Teleport to="body">
            <div v-if="drawerOpen" ref="drawerRoot">
                <div
                    data-testid="seller-nav-backdrop"
                    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
                    @click="closeMenu"
                />
                <div
                    id="seller-nav-drawer"
                    ref="panel"
                    data-testid="seller-nav-drawer"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Navigation menu"
                    class="fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] bg-white border-r border-slate-200/90 flex flex-col md:hidden"
                >
                    <div
                        class="h-16 flex items-center justify-between border-b border-slate-100 px-4"
                    >
                        <span
                            class="text-base font-extrabold tracking-tight text-slate-900"
                        >
                            GroceryPOS
                        </span>
                        <button
                            type="button"
                            class="min-h-11 min-w-11 -mr-2 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus-ring"
                            aria-label="Close navigation menu"
                            data-testid="seller-nav-close"
                            @click="closeMenu"
                        >
                            <X class="w-5 h-5" aria-hidden="true" />
                        </button>
                    </div>
                    <nav class="p-3 space-y-1.5">
                        <button
                            v-for="item in menuItems"
                            :key="item.route"
                            type="button"
                            class="w-full min-h-11 flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm transition-all focus-ring"
                            :class="
                                item.active
                                    ? 'bg-primary-600 text-white font-bold shadow-xs'
                                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-semibold'
                            "
                            :aria-current="item.active ? 'page' : undefined"
                            @click="go(item.route)"
                        >
                            <component
                                :is="item.icon"
                                class="w-5 h-5 shrink-0"
                                aria-hidden="true"
                            />
                            <span>{{ item.label }}</span>
                        </button>
                    </nav>
                </div>
            </div>
        </Teleport>
    </header>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
    LayoutDashboard,
    Menu,
    ReceiptText,
    ShoppingCart,
    Store,
    X,
} from '@lucide/vue';
import { useCartStore } from '@/stores/cart';
import { useShiftStore } from '@/stores/shift';
import { MD_QUERY, useMediaQuery } from '@/composables/useMediaQuery';
import { useModalDrawer } from '@/composables/useModalDrawer';
import UserProfileMenu from './UserProfileMenu.vue';

const route = useRoute();
const router = useRouter();
const cartStore = useCartStore();
const shiftStore = useShiftStore();
const drawerRoot = useTemplateRef<HTMLElement>('drawerRoot');
const panel = useTemplateRef<HTMLElement>('panel');

const cartCount = computed(() => cartStore.totalUnits);
const isDashboard = computed(() => route.name === 'SellerDashboard');
const isOrders = computed(() => route.name === 'Sales');
const isRegister = computed(() => route.name === 'Sell');

/** From md up the tabs are in the header; below it, in the menu. */
const isMedium = useMediaQuery(MD_QUERY, true);
const menuOpen = ref(false);
const drawerOpen = computed(() => !isMedium.value && menuOpen.value);

function closeMenu() {
    menuOpen.value = false;
}

useModalDrawer({
    open: drawerOpen,
    close: closeMenu,
    root: () => drawerRoot.value,
    panel: () => panel.value,
    id: 'seller-nav-drawer',
});
watch(isMedium, (medium) => {
    if (medium) closeMenu();
});

const menuItems = computed(() => [
    {
        label: 'Dashboard',
        icon: LayoutDashboard,
        route: 'SellerDashboard',
        active: isDashboard.value,
    },
    {
        label: 'Orders & Sales',
        icon: ReceiptText,
        route: 'Sales',
        active: isOrders.value,
    },
]);

function go(name: string) {
    closeMenu();
    void router.push({ name });
}
</script>
