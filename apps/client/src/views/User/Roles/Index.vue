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
                    :data-testid="`role-${role.key}`"
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
                            class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2"
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
import type { Component } from 'vue';
import {
    ClipboardEdit,
    Crown,
    ShieldCheck,
    ShoppingCart,
    Truck,
    Users,
} from '@lucide/vue';
import {
    ASSIGNABLE_ROLES,
    appPermissionsOf,
    Role,
} from '@grocery-pos/contracts';
import PageCard from '@/components/ui/PageCard.vue';
import Badge from '@/components/ui/Badge.vue';

/**
 * One card per assignable role. What each role may do comes from
 * `PERMISSIONS` in contracts, which the API's role-permissions spec checks
 * against every controller's `@Roles(...)` (issue #24); only the look of a
 * card lives here.
 */
type AssignableRole = Exclude<Role, Role.Unauthenticated>;

const LOOK: Record<
    AssignableRole,
    { label: string; icon: Component; avatarClass: string }
> = {
    [Role.Admin]: {
        label: 'Admin',
        icon: Crown,
        avatarClass: 'bg-primary-50 text-primary-600',
    },
    [Role.Seller]: {
        label: 'Seller',
        icon: ShoppingCart,
        avatarClass: 'bg-emerald-50 text-emerald-600',
    },
    [Role.Restocker]: {
        label: 'Restocker',
        icon: Truck,
        avatarClass: 'bg-sky-50 text-sky-600',
    },
    [Role.Adjuster]: {
        label: 'Adjuster',
        icon: ClipboardEdit,
        avatarClass: 'bg-amber-50 text-amber-600',
    },
    [Role.UserManager]: {
        label: 'User Manager',
        icon: Users,
        avatarClass: 'bg-purple-50 text-purple-600',
    },
};

const roles = ASSIGNABLE_ROLES.map((role) => ({
    key: role,
    // ASSIGNABLE_ROLES never holds Unauthenticated (see contracts roles.ts).
    ...LOOK[role as AssignableRole],
    permissions: appPermissionsOf(role).map((p) => p.label),
}));
</script>
