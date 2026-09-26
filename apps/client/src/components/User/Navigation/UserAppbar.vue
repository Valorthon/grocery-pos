<template>
    <header
        class="w-full bg-white border-b border-slate-200 h-16 shrink-0 z-30 flex items-center justify-between px-4"
    >
        <div class="flex items-center gap-3">
            <!-- Below lg the sidebar is a drawer (#89): its menu button. -->
            <button
                type="button"
                class="lg:hidden min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors focus-ring"
                aria-label="Open navigation menu"
                aria-controls="admin-sidebar"
                :aria-expanded="drawerOpen"
                data-testid="admin-menu"
                @click="emit('open-drawer')"
            >
                <Menu class="w-6 h-6" aria-hidden="true" />
            </button>

            <button
                type="button"
                class="flex items-center gap-2.5 focus-ring"
                aria-label="GroceryPOS dashboard"
                @click="router.push({ name: 'Dashboard' })"
            >
                <div
                    class="w-8 h-8 rounded-lg bg-primary-600/10 text-primary-600 flex items-center justify-center border border-primary-600/20"
                >
                    <Store class="w-5 h-5" />
                </div>
                <span
                    class="text-xl font-extrabold tracking-tight text-primary-600 hidden sm:inline"
                >
                    GroceryPOS
                </span>
            </button>
        </div>

        <div class="flex items-center gap-2">
            <button
                v-if="canAddProduct"
                type="button"
                class="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus-ring"
                title="Add Product"
                aria-label="Add Product"
                @click="router.push({ name: 'Products/Add' })"
            >
                <TagPlus class="w-5 h-5" />
            </button>

            <button
                v-if="canRestock"
                type="button"
                class="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus-ring"
                title="Restock Inventory"
                aria-label="Restock Inventory"
                @click="router.push({ name: 'Restocks/Add' })"
            >
                <PackagePlus class="w-5 h-5" />
            </button>

            <button
                v-if="canAdjust"
                type="button"
                class="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus-ring"
                title="Adjust Stock"
                aria-label="Adjust Stock"
                @click="router.push({ name: 'Adjustments/Add' })"
            >
                <SlidersHorizontal class="w-5 h-5" />
            </button>

            <UserProfileMenu variant="bar" />
        </div>
    </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
    Menu,
    PackagePlus,
    SlidersHorizontal,
    Store,
    TagPlus,
} from '@lucide/vue';
import { useAuthStore, Role } from '@/stores/auth';
import UserProfileMenu from '@/components/User/Sales/UserProfileMenu.vue';

defineProps<{ drawerOpen: boolean }>();
const emit = defineEmits<{ (e: 'open-drawer'): void }>();

const router = useRouter();
const authStore = useAuthStore();

const canAddProduct = computed(
    () => authStore.hasRole(Role.Restocker) || authStore.isAdmin,
);
const canRestock = computed(
    () => authStore.hasRole(Role.Restocker) || authStore.isAdmin,
);
const canAdjust = computed(
    () => authStore.hasRole(Role.Adjuster) || authStore.isAdmin,
);
</script>
