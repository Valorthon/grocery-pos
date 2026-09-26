<template>
    <!--
        Below lg the sidebar is a modal drawer (#89, as the seller one in
        #26): the app bar's menu button opens it; the backdrop, its X,
        Escape and any navigation close it. It then lives under <body> (the
        teleport) as an entry on the modal stack, so the page behind it is
        inert. From lg up it is a rail in the page that can be collapsed.
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
                    data-testid="admin-sidebar-backdrop"
                    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
                    @click="closeDrawer"
                />
            </Transition>

            <aside
                id="admin-sidebar"
                ref="aside"
                data-testid="admin-sidebar"
                class="bg-white border-r border-slate-200/90 flex flex-col shrink-0 transition-[width,translate] duration-300 select-none fixed inset-y-0 left-0 z-50 w-64 h-full lg:static lg:z-30 lg:translate-x-0"
                :class="[
                    rail ? 'lg:w-20' : 'lg:w-64',
                    drawerOpen ? 'translate-x-0' : '-translate-x-full',
                ]"
                :inert="hiddenDrawer || undefined"
                :aria-hidden="hiddenDrawer ? 'true' : undefined"
                :aria-label="isLarge ? undefined : 'Navigation menu'"
            >
                <div class="flex-1 overflow-y-auto">
                    <div
                        class="h-16 flex items-center border-b border-slate-100 px-4"
                        :class="rail ? 'justify-center' : 'justify-between'"
                    >
                        <div
                            v-if="!rail"
                            class="flex items-center justify-between w-full"
                        >
                            <div class="flex items-center gap-2.5 min-w-0">
                                <div
                                    class="w-9 h-9 rounded-xl bg-primary-600/10 text-primary-600 flex items-center justify-center border border-primary-600/20 shrink-0"
                                >
                                    <Store class="w-5 h-5" />
                                </div>
                                <span
                                    class="text-base font-extrabold tracking-tight text-slate-900 truncate"
                                >
                                    GroceryPOS
                                </span>
                            </div>
                            <button
                                v-if="isLarge"
                                type="button"
                                class="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 focus-ring"
                                aria-label="Collapse sidebar"
                                data-testid="admin-sidebar-collapse"
                                @click="collapsed = true"
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
                                data-testid="admin-sidebar-close"
                                @click="closeDrawer"
                            >
                                <X class="w-5 h-5" aria-hidden="true" />
                            </button>
                        </div>

                        <button
                            v-else
                            type="button"
                            class="w-11 h-11 rounded-xl bg-primary-600/10 text-primary-600 hover:bg-primary-600 hover:text-white flex items-center justify-center border border-primary-600/20 hover:border-primary-600 transition-all focus-ring"
                            aria-label="Expand sidebar"
                            data-testid="admin-sidebar-expand"
                            @click="collapsed = false"
                        >
                            <Store class="w-5 h-5" aria-hidden="true" />
                        </button>
                    </div>

                    <nav class="p-3 space-y-1">
                        <template
                            v-for="section in sections"
                            :key="section.title"
                        >
                            <div
                                v-if="!rail"
                                class="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-400"
                            >
                                {{ section.title }}
                            </div>
                            <button
                                v-for="item in section.items"
                                v-show="item.visible"
                                :key="item.name"
                                type="button"
                                class="w-full flex items-center rounded-xl transition-all group relative focus-ring"
                                :class="[
                                    rail
                                        ? 'justify-center p-3'
                                        : 'justify-between min-h-11 px-3.5 py-2.5',
                                    isActive(item.name)
                                        ? 'bg-primary-600 text-white font-bold shadow-xs'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-semibold',
                                ]"
                                :title="rail ? item.title : undefined"
                                :aria-label="rail ? item.title : undefined"
                                :aria-current="
                                    isActive(item.name) ? 'page' : undefined
                                "
                                @click="navigate(item.name)"
                            >
                                <div class="flex items-center gap-3 min-w-0">
                                    <component
                                        :is="item.icon"
                                        class="w-5 h-5 shrink-0"
                                        :class="
                                            isActive(item.name)
                                                ? 'text-white'
                                                : 'text-slate-500 group-hover:text-slate-900'
                                        "
                                    />
                                    <span
                                        v-if="!rail"
                                        class="text-sm block truncate"
                                        >{{ item.title }}</span
                                    >
                                </div>
                            </button>
                        </template>
                    </nav>
                </div>

                <div class="p-3 border-t border-slate-200/80">
                    <UserProfileMenu :variant="rail ? 'icon' : 'box'" />
                </div>
            </aside>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
    ClipboardEdit,
    Clock,
    LayoutDashboard,
    List,
    Package,
    PanelLeftClose,
    Receipt,
    Shield,
    Store,
    Truck,
    Users,
    X,
} from '@lucide/vue';
import { useAuthStore, Role } from '@/stores/auth';
import { canViewDashboard } from '@/router/access';
import UserProfileMenu from '@/components/User/Sales/UserProfileMenu.vue';
import { useIsLarge } from '@/composables/useMediaQuery';
import { useModalDrawer } from '@/composables/useModalDrawer';

/** `modelValue`: whether the drawer is open (below lg only). */
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const aside = useTemplateRef<HTMLElement>('aside');
const drawerRoot = useTemplateRef<HTMLElement>('drawerRoot');

const isLarge = useIsLarge();
/** The rail's collapse, from lg up; the drawer always shows its labels. */
const collapsed = ref(false);
const rail = computed(() => isLarge.value && collapsed.value);
const drawerOpen = computed(() => !isLarge.value && props.modelValue);
/** Below lg and closed: off screen, and out of the tab order. */
const hiddenDrawer = computed(() => !isLarge.value && !props.modelValue);

function closeDrawer() {
    if (props.modelValue) emit('update:modelValue', false);
}

// The open drawer on the shared modal stack: Escape, trap, inert page;
// any navigation closes it, and so does growing to lg.
useModalDrawer({
    open: drawerOpen,
    close: closeDrawer,
    root: () => drawerRoot.value,
    panel: () => aside.value,
    id: 'admin-sidebar',
});
watch(isLarge, (large) => {
    if (large) closeDrawer();
});

const canViewProducts = computed(
    () =>
        authStore.hasRole(Role.Restocker) ||
        authStore.hasRole(Role.Adjuster) ||
        authStore.isAdmin,
);
const canViewInventory = canViewProducts;
const canViewRestocks = computed(
    () => authStore.hasRole(Role.Restocker) || authStore.isAdmin,
);
const canViewAdjustments = computed(
    () => authStore.hasRole(Role.Adjuster) || authStore.isAdmin,
);
const canViewUsers = computed(
    () => authStore.hasRole(Role.UserManager) || authStore.isAdmin,
);

const sections = computed(() => [
    {
        title: 'Main',
        items: [
            {
                name: 'Dashboard',
                title: 'Dashboard',
                icon: LayoutDashboard,
                visible: canViewDashboard(authStore.user?.roles ?? []),
            },
            {
                name: 'SalesHistory',
                title: 'Sales History',
                icon: Receipt,
                visible: authStore.isAdmin,
            },
            {
                name: 'Shifts',
                title: 'Shifts',
                icon: Clock,
                visible: authStore.isAdmin,
            },
        ],
    },
    {
        title: 'Inventory Management',
        items: [
            {
                name: 'Products',
                title: 'Product List',
                icon: List,
                visible: canViewProducts.value,
            },
            {
                name: 'Inventories',
                title: 'Inventory',
                icon: Package,
                visible: canViewInventory.value,
            },
            {
                name: 'Restocks',
                title: 'Restock History',
                icon: Truck,
                visible: canViewRestocks.value,
            },
            {
                name: 'Adjustments',
                title: 'Adjustment History',
                icon: ClipboardEdit,
                visible: canViewAdjustments.value,
            },
        ],
    },
    {
        title: 'Admin',
        items: [
            {
                name: 'Users',
                title: 'Users',
                icon: Users,
                visible: canViewUsers.value,
            },
            {
                name: 'Roles',
                title: 'Roles',
                icon: Shield,
                visible: canViewUsers.value,
            },
        ],
    },
]);

function isActive(name: string) {
    return route.name === name;
}

function navigate(name: string) {
    closeDrawer();
    void router.push({ name });
}
</script>
