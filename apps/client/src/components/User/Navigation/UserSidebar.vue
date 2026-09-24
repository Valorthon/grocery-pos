<template>
    <!-- Mobile overlay -->
    <Transition
        enter-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-200"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
    >
        <div
            v-if="mobileOpen"
            class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
            @click="emit('update:modelValue', false)"
        />
    </Transition>

    <aside
        class="bg-white border-r border-slate-200/90 flex flex-col shrink-0 transition-all duration-300 z-50 select-none"
        :class="[
            rail ? 'w-20' : 'w-64',
            'fixed lg:static inset-y-0 left-0 h-full',
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ]"
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
                        type="button"
                        class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                        @click="rail = !rail"
                    >
                        <PanelLeftClose class="w-4 h-4" />
                    </button>
                </div>

                <button
                    v-else
                    type="button"
                    class="w-10 h-10 rounded-xl bg-primary-600/10 text-primary-600 hover:bg-primary-600 hover:text-white flex items-center justify-center border border-primary-600/20 hover:border-primary-600 transition-all"
                    @click="rail = !rail"
                >
                    <Store class="w-5 h-5" />
                </button>
            </div>

            <nav class="p-3 space-y-1">
                <template v-for="section in sections" :key="section.title">
                    <div
                        v-if="!rail"
                        class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400"
                    >
                        {{ section.title }}
                    </div>
                    <button
                        v-for="item in section.items"
                        v-show="item.visible"
                        :key="item.name"
                        type="button"
                        class="w-full flex items-center rounded-xl transition-all group relative"
                        :class="[
                            rail
                                ? 'justify-center p-3'
                                : 'justify-between px-3.5 py-2.5',
                            isActive(item.name)
                                ? 'bg-primary-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-semibold',
                        ]"
                        :title="rail ? item.title : undefined"
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
                            <span v-if="!rail" class="text-sm block truncate">{{
                                item.title
                            }}</span>
                        </div>
                    </button>
                </template>
            </nav>
        </div>

        <div class="p-3 border-t border-slate-200/80">
            <UserProfileMenu :variant="rail ? 'icon' : 'box'" />
        </div>
    </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
    ClipboardEdit,
    LayoutDashboard,
    List,
    Package,
    PanelLeftClose,
    Receipt,
    Shield,
    Store,
    Truck,
    Users,
} from '@lucide/vue';
import { useAuthStore, Role } from '@/stores/auth';
import UserProfileMenu from '@/components/User/Sales/UserProfileMenu.vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const rail = ref(false);
const mobileOpen = computed(() => props.modelValue);

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
                visible: true,
            },
            {
                name: 'SalesHistory',
                title: 'Sales History',
                icon: Receipt,
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
    router.push({ name });
    emit('update:modelValue', false);
}
</script>
