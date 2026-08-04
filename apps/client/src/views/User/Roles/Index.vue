<template>
    <v-card elevation="2" class="rounded-lg border">
        <v-card-title class="d-flex align-center px-4 py-3 bg-grey-lighten-4">
            <v-icon
                icon="mdi-shield-account-outline"
                color="amber-darken-2"
                class="me-2"
            />
            <span class="text-subtitle-1 font-weight-bold"
                >Roles & Permissions</span
            >
        </v-card-title>

        <v-divider />

        <v-card-text class="pa-4">
            <v-row>
                <v-col
                    v-for="role in roles"
                    :key="role.key"
                    cols="12"
                    md="6"
                    xl="4"
                >
                    <v-card rounded="xl" elevation="0" border class="h-100">
                        <v-card-title class="d-flex align-center ga-2 pa-5">
                            <v-avatar
                                :color="role.color"
                                variant="tonal"
                                size="36"
                            >
                                <v-icon :color="role.color" size="20">
                                    {{ role.icon }}
                                </v-icon>
                            </v-avatar>
                            <span class="text-subtitle-1 font-weight-bold">
                                {{ role.label }}
                            </span>
                        </v-card-title>
                        <v-divider />
                        <v-card-text class="pa-5">
                            <div class="text-caption text-medium-emphasis mb-2">
                                Permissions
                            </div>
                            <v-chip
                                v-for="perm in role.permissions"
                                :key="perm"
                                size="small"
                                variant="tonal"
                                class="me-1 mb-1"
                            >
                                {{ perm }}
                            </v-chip>
                        </v-card-text>
                    </v-card>
                </v-col>
            </v-row>
        </v-card-text>
    </v-card>
</template>

<script setup lang="ts">
const roles = [
    {
        key: 'ADMIN',
        label: 'Admin',
        icon: 'mdi-shield-crown-outline',
        color: 'primary',
        permissions: [
            'Full Access',
            'View Dashboard',
            'Manage Products',
            'Manage Inventory',
            'Manage Restocks',
            'Manage Adjustments',
            'Sell Products',
            'Manage Users',
            'View Sales History',
        ],
    },
    {
        key: 'SELLER',
        label: 'Seller',
        icon: 'mdi-cart-outline',
        color: 'success',
        permissions: [
            'View Dashboard',
            'Sell Products',
            'View Sales History',
            'Lookup Products by Barcode',
        ],
    },
    {
        key: 'RESTOCKER',
        label: 'Restocker',
        icon: 'mdi-truck-delivery-outline',
        color: 'info',
        permissions: [
            'View Dashboard',
            'View Product List',
            'Add New Products',
            'View Inventory',
            'Create Restocks',
            'View Restock History',
        ],
    },
    {
        key: 'ADJUSTER',
        label: 'Adjuster',
        icon: 'mdi-clipboard-edit-outline',
        color: 'warning',
        permissions: [
            'View Dashboard',
            'View Product List',
            'View Inventory',
            'Create Adjustments',
            'View Adjustment History',
        ],
    },
    {
        key: 'USER_MANAGER',
        label: 'User Manager',
        icon: 'mdi-account-multiple-outline',
        color: 'purple',
        permissions: ['View Dashboard', 'Manage Users', 'View Roles'],
    },
];
</script>
