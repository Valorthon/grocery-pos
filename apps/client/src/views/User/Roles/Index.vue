<template>
    <PageFrame>
        <PageCard>
            <div class="p-5">
                <div
                    class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                >
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
                            <p
                                v-if="role.note"
                                class="mt-3 text-xs text-slate-500"
                                :data-testid="`note-${role.key}`"
                            >
                                {{ role.note }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </PageCard>
    </PageFrame>
</template>

<script setup lang="ts">
import { ASSIGNABLE_ROLES, appPermissionsOf } from '@grocery-pos/contracts';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import Badge from '@/components/ui/Badge.vue';
import { type AssignableRole, ROLE_LOOK } from '../role-look';

/**
 * One card per assignable role. What each role may do comes from
 * `PERMISSIONS` in contracts, which the API's role-permissions spec checks
 * against every controller's `@Roles(...)` (issue #24); the look of a card
 * is shared with the Users screen (`role-look.ts`, #297).
 */
const roles = ASSIGNABLE_ROLES.map((role) => ({
    key: role,
    // ASSIGNABLE_ROLES never holds Unauthenticated (see contracts roles.ts).
    ...ROLE_LOOK[role as AssignableRole],
    permissions: appPermissionsOf(role).map((p) => p.label),
}));
</script>
