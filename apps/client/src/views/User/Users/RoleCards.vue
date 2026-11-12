<template>
    <div
        role="group"
        :aria-labelledby="labelledby"
        class="grid grid-cols-1 sm:grid-cols-2 gap-2"
    >
        <label
            v-for="role in roles"
            :key="role"
            :data-testid="`role-card-${role}`"
            class="flex items-start gap-3 rounded-control border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-leaf-600 has-[:focus-visible]:ring-offset-1"
            :class="[
                selected.includes(role)
                    ? 'border-leaf-600 bg-leaf-50'
                    : 'border-line-strong bg-surface',
                isDisabled(role)
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer hover:border-leaf-500',
            ]"
        >
            <input
                type="checkbox"
                class="mt-0.5 h-4 w-4 shrink-0 accent-leaf-600 outline-none"
                :checked="selected.includes(role)"
                :disabled="isDisabled(role)"
                :aria-labelledby="`${idPrefix}-${role}-name`"
                :aria-describedby="
                    isDisabled(role) && hintId
                        ? `${idPrefix}-${role}-desc ${hintId}`
                        : `${idPrefix}-${role}-desc`
                "
                @change="
                    emit(
                        'toggle',
                        role,
                        ($event.target as HTMLInputElement).checked,
                    )
                "
            />
            <span
                class="w-8 h-8 shrink-0 rounded-xl flex items-center justify-center"
                :class="look(role).avatarClass"
                aria-hidden="true"
            >
                <component :is="look(role).icon" :size="16" />
            </span>
            <span class="min-w-0">
                <span
                    :id="`${idPrefix}-${role}-name`"
                    class="block text-sm font-semibold text-ink"
                    >{{ look(role).label }}</span
                >
                <span
                    :id="`${idPrefix}-${role}-desc`"
                    class="block text-xs text-muted"
                    >{{ look(role).description }}</span
                >
            </span>
        </label>
    </div>
</template>

<script setup lang="ts">
import type { Role } from '@grocery-pos/contracts';
import { type AssignableRole, ROLE_LOOK } from '../role-look';

/**
 * The Users dialogs' roles as selectable cards (#297): one labelled
 * checkbox per card, its description tied by `aria-describedby`. A checked
 * card is highlighted and keeps its tick, so the state is not colour alone.
 */
withDefaults(
    defineProps<{
        roles: readonly Role[];
        selected: readonly Role[];
        /** Makes the ids unique per dialog. */
        idPrefix: string;
        /** The id of the heading naming the group. */
        labelledby: string;
        /** The id of the hint saying why cards are disabled. */
        hintId?: string;
        isDisabled?: (role: Role) => boolean;
    }>(),
    { isDisabled: () => false, hintId: '' },
);

const emit = defineEmits<{
    (e: 'toggle', role: Role, checked: boolean): void;
}>();

function look(role: Role) {
    return ROLE_LOOK[role as AssignableRole];
}
</script>
