<template>
    <v-navigation-drawer
        v-model="drawerModel"
        :rail="rail"
        permanent
        color="#0A303C"
        width="260"
    >
        <v-list nav density="comfortable">
            <v-list-subheader
                v-if="!rail"
                class="text-uppercase text-caption font-weight-bold opacity-50 text-white"
            >
                Main
            </v-list-subheader>

            <v-list-item
                prepend-icon="mdi-view-dashboard-outline"
                title="Dashboard"
                :to="{ name: 'Dashboard' }"
                rounded="lg"
                color="amber-darken-2"
                base-color="white"
            />

            <v-list-item
                v-if="canViewSales"
                prepend-icon="mdi-cart-outline"
                title="Sales"
                :to="{ name: 'Sales' }"
                rounded="lg"
                color="amber-darken-2"
                base-color="white"
            />

            <v-divider v-if="!rail" class="my-3 opacity-20" />

            <v-list-subheader
                v-if="!rail"
                class="text-uppercase text-caption font-weight-bold opacity-50 text-white"
            >
                Inventory Management
            </v-list-subheader>

            <v-list-item
                v-if="canViewProducts"
                prepend-icon="mdi-format-list-bulleted"
                title="Product List"
                :to="{ name: 'Products' }"
                rounded="lg"
                color="amber-darken-2"
                base-color="white"
            />

            <v-list-item
                v-if="canViewInventory"
                prepend-icon="mdi-package-variant-closed"
                title="Inventory"
                :to="{ name: 'Inventories' }"
                rounded="lg"
                color="amber-darken-2"
                base-color="white"
            />

            <v-list-item
                v-if="canViewRestocks"
                prepend-icon="mdi-truck-delivery-outline"
                title="Restock History"
                rounded="lg"
                :to="{ name: 'Restocks' }"
                color="amber-darken-2"
                base-color="white"
            />

            <v-list-item
                v-if="canViewAdjustments"
                prepend-icon="mdi-clipboard-edit-outline"
                title="Adjustment History"
                :to="{ name: 'Adjustments' }"
                rounded="lg"
                color="amber-darken-2"
                base-color="white"
            />

            <v-divider v-if="!rail" class="my-3 opacity-20" />

            <v-list-subheader
                v-if="!rail"
                class="text-uppercase text-caption font-weight-bold opacity-50 text-white"
            >
                Admin
            </v-list-subheader>

            <v-list-item
                v-if="canViewUsers"
                prepend-icon="mdi-account-multiple-outline"
                title="Users"
                :to="{ name: 'Users' }"
                rounded="lg"
                color="amber-darken-2"
                base-color="white"
            />

            <v-list-item
                v-if="canViewUsers"
                prepend-icon="mdi-shield-account-outline"
                title="Roles"
                :to="{ name: 'Roles' }"
                rounded="lg"
                color="amber-darken-2"
                base-color="white"
            />
        </v-list>

        <!-- Collapse toggle pinned to bottom -->
        <template #append>
            <v-divider class="opacity-20" />
            <v-list-item
                :prepend-icon="rail ? 'mdi-chevron-right' : 'mdi-chevron-left'"
                :title="rail ? '' : 'Collapse'"
                rounded="lg"
                base-color="white"
                class="opacity-60 my-1"
                @click="rail = !rail"
            />
        </template>
    </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore, Role } from '@/stores/auth';

const authStore = useAuthStore();

const props = defineProps({
    modelValue: {
        type: Boolean,
        default: true,
    },
});
const emit = defineEmits(['update:modelValue']);

const drawerModel = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const rail = ref(false);

const canViewProducts = computed(
    () =>
        authStore.hasRole(Role.Restocker) ||
        authStore.hasRole(Role.Adjuster) ||
        authStore.isAdmin,
);
const canViewInventory = computed(
    () =>
        authStore.hasRole(Role.Restocker) ||
        authStore.hasRole(Role.Adjuster) ||
        authStore.isAdmin,
);
const canViewRestocks = computed(
    () => authStore.hasRole(Role.Restocker) || authStore.isAdmin,
);
const canViewAdjustments = computed(
    () => authStore.hasRole(Role.Adjuster) || authStore.isAdmin,
);
const canViewUsers = computed(
    () => authStore.hasRole(Role.UserManager) || authStore.isAdmin,
);
const canViewSales = computed(
    () => authStore.hasRole(Role.Seller) || authStore.isAdmin,
);
</script>
