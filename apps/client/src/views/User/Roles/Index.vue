<template>
    <PageCard title="Roles & Permissions">
        <template #icon>
            <ShieldCheck class="w-5 h-5 text-primary-600" />
        </template>

        <div class="p-5">
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <div
                    v-for="role in roles"
                    :key="role.key"
                    class="bg-white rounded-2xl border border-slate-200 overflow-hidden"
                >
                    <div class="flex items-center gap-3 px-5 py-4">
                        <div
                            class="w-9 h-9 rounded-xl flex items-center justify-center"
                            :class="role.avatarClass"
                        >
                            <component :is="role.icon" :size="18" />
                        </div>
                        <span class="text-base font-bold text-slate-900">{{
                            role.label
                        }}</span>
                    </div>
                    <div class="border-t border-slate-100 px-5 py-4">
                        <div
                            class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2"
                        >
                            Permissions
                        </div>
                        <div class="flex flex-wrap gap-1.5">
                            <Badge
                                v-for="perm in role.permissions"
                                :key="perm"
                                color="neutral"
                                >{{ perm }}</Badge
                            >
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </PageCard>
</template>

<script setup lang="ts">
import {
    ClipboardEdit,
    Crown,
    ShieldCheck,
    ShoppingCart,
    Truck,
    Users,
} from '@lucide/vue';
import PageCard from '@/components/ui/PageCard.vue';
import Badge from '@/components/ui/Badge.vue';

const roles = [
    {
        key: 'ADMIN',
        label: 'Admin',
        icon: Crown,
        avatarClass: 'bg-primary-50 text-primary-600',
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
        icon: ShoppingCart,
        avatarClass: 'bg-emerald-50 text-emerald-600',
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
        icon: Truck,
        avatarClass: 'bg-sky-50 text-sky-600',
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
        icon: ClipboardEdit,
        avatarClass: 'bg-amber-50 text-amber-600',
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
        icon: Users,
        avatarClass: 'bg-purple-50 text-purple-600',
        permissions: ['View Dashboard', 'Manage Users', 'View Roles'],
    },
];
</script>
