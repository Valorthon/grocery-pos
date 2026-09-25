<template>
    <!--
        Below lg the sidebar is a modal drawer (issue #26): a menu button
        opens it; the backdrop, its X, Escape and any navigation close it.
        It then lives under <body> (the teleport) as an entry on the modal
        stack, so the register behind it is inert and its keys pause. From
        lg up it is a rail in the page that the cashier collapses or
        expands; the choice is remembered per user on this device.
    -->
    <Teleport to="body" :disabled="isLarge">
        <div ref="drawerRoot" :class="isLarge ? 'contents' : undefined">
            <Transition
                enter-active-class="transition-opacity duration-200"
                enter-from-class="opacity-0"
                enter-to-class="opacity-100"
                leave-active-class="transition-opacity duration-200"
                leave-from-class="opacity-100"
                leave-to-class="opacity-0"
            >
                <div
                    v-if="drawerOpen"
                    data-testid="sidebar-backdrop"
                    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
                    @click="closeDrawer"
                />
            </Transition>

            <aside
                id="seller-sidebar"
                ref="aside"
                data-testid="seller-sidebar"
                class="bg-white border-r border-slate-200/90 flex flex-col justify-between shrink-0 transition-[width,translate] duration-300 select-none fixed inset-y-0 left-0 z-50 w-64 h-full lg:static lg:z-30 lg:translate-x-0"
                :class="[
                    isCollapsed ? 'lg:w-20' : 'lg:w-64',
                    drawerOpen ? 'translate-x-0' : '-translate-x-full',
                ]"
                :inert="hiddenDrawer || undefined"
                :aria-hidden="hiddenDrawer ? 'true' : undefined"
                :aria-label="isLarge ? undefined : 'Navigation menu'"
            >
                <div class="overflow-hidden">
                    <!-- Brand + collapse toggle -->
                    <div
                        class="h-16 flex items-center border-b border-slate-100 px-4"
                        :class="
                            isCollapsed ? 'justify-center' : 'justify-between'
                        "
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
                                    class="text-xs text-slate-400 font-bold uppercase tracking-wider block"
                                >
                                    {{ terminal }} Terminal
                                </span>
                            </div>

                            <button
                                v-if="isLarge"
                                type="button"
                                class="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 focus-ring"
                                aria-label="Collapse sidebar"
                                data-testid="sidebar-collapse"
                                @click="toggle"
                            >
                                <PanelLeftClose
                                    class="w-4 h-4"
                                    aria-hidden="true"
                                />
                            </button>
                            <button
                                v-else
                                type="button"
                                class="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 focus-ring"
                                aria-label="Close navigation menu"
                                data-testid="sidebar-close"
                                @click="closeDrawer"
                            >
                                <X class="w-5 h-5" aria-hidden="true" />
                            </button>
                        </div>

                        <button
                            v-else
                            type="button"
                            class="w-11 h-11 rounded-xl bg-primary-600/10 text-primary-600 hover:bg-primary-600 hover:text-white flex items-center justify-center border border-primary-600/20 hover:border-primary-600 transition-all duration-200 group relative focus-ring"
                            aria-label="Expand sidebar"
                            data-testid="sidebar-expand"
                            @click="toggle"
                        >
                            <Store class="w-5 h-5 group-hover:hidden" />
                            <PanelLeft
                                class="w-5 h-5 hidden group-hover:block"
                            />
                        </button>
                    </div>

                    <!-- Nav items -->
                    <nav class="p-3 space-y-1.5">
                        <button
                            v-for="item in navItems"
                            :key="item.id"
                            type="button"
                            class="w-full flex items-center rounded-xl transition-all group relative focus-ring"
                            :class="[
                                isCollapsed
                                    ? 'justify-center p-3'
                                    : 'justify-between px-3.5 py-3',
                                isActive(item.id)
                                    ? 'bg-primary-600 text-white font-bold shadow-xs'
                                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-semibold',
                            ]"
                            :title="isCollapsed ? item.label : undefined"
                            :aria-label="isCollapsed ? item.label : undefined"
                            :aria-current="
                                isActive(item.id) ? 'page' : undefined
                            "
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
                                class="text-xs font-black px-2 py-0.5 rounded-full"
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
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
    LayoutDashboard,
    PanelLeft,
    PanelLeftClose,
    ReceiptText,
    ShoppingCart,
    Store,
    X,
} from '@lucide/vue';
import { DEFAULT_TERMINAL } from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import { useShiftStore } from '@/stores/shift';
import { useIsLarge } from '@/composables/useMediaQuery';
import { useSidebarPreference } from '@/composables/useSidebarPreference';
import {
    type ModalEntry,
    pushModal,
    removeModal,
} from '@/components/ui/modal-stack';
import UserProfileMenu from './UserProfileMenu.vue';

/** `modelValue`: whether the drawer is open (below lg only). */
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const cartStore = useCartStore();
const shiftStore = useShiftStore();
const aside = useTemplateRef<HTMLElement>('aside');
const drawerRoot = useTemplateRef<HTMLElement>('drawerRoot');

const isLarge = useIsLarge();
const { collapsed, toggle } = useSidebarPreference(
    () => authStore.user?.userId,
);
/** The rail: collapsed only applies from lg up; the drawer shows labels. */
const isCollapsed = computed(() => isLarge.value && collapsed.value);
const drawerOpen = computed(() => !isLarge.value && props.modelValue);
/** Below lg and closed: off screen, and out of the tab order. */
const hiddenDrawer = computed(() => !isLarge.value && !props.modelValue);

// A label until terminals get an identity of their own (#47).
const terminal = computed(
    () => shiftStore.activeShift?.terminal ?? DEFAULT_TERMINAL,
);
const cartCount = computed(() => cartStore.totalUnits);

function closeDrawer() {
    if (props.modelValue) emit('update:modelValue', false);
}

/** The open drawer on the shared modal stack: Escape, trap, inert page. */
const entry: ModalEntry = {
    root: () => drawerRoot.value,
    panel: () => aside.value,
    closable: () => true,
    close: closeDrawer,
    opener: null,
};

watch(
    drawerOpen,
    (open) => {
        if (!open) {
            removeModal(entry);
            return;
        }
        const active = document.activeElement;
        entry.opener =
            active instanceof HTMLElement && active !== document.body
                ? active
                : null;
        pushModal(entry);
        aside.value?.querySelector<HTMLElement>('nav button')?.focus();
    },
    { flush: 'post' },
);

// Any navigation closes the drawer; so does growing to lg.
watch(() => route.fullPath, closeDrawer);
watch(isLarge, (large) => {
    if (large) closeDrawer();
});

onBeforeUnmount(() => removeModal(entry));

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
    closeDrawer();
    if (item.id === 'register') {
        void shiftStore.goToRegister();
        return;
    }
    void router.push({ name: item.route });
}
</script>
