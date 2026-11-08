<template>
    <BaseDropdown v-model="open" align="right" width-class="w-48">
        <template #trigger="{ trigger }">
            <button
                ref="triggerRef"
                v-bind="trigger"
                class="w-11 h-11 rounded-control flex items-center justify-center text-muted hover:bg-paper transition-colors focus-ring"
                :aria-label="`Actions for ${label}`"
                :title="`Actions for ${label}`"
            >
                <Ellipsis class="w-5 h-5" aria-hidden="true" />
            </button>
        </template>
        <template #menu>
            <button
                v-for="action in actions"
                :key="action.label"
                type="button"
                role="menuitem"
                :disabled="action.disabled"
                :class="[
                    'w-full min-h-11 px-3 rounded-lg flex items-center text-left text-sm font-semibold transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed',
                    action.danger
                        ? 'text-danger-fg hover:bg-danger-bg'
                        : 'text-ink hover:bg-paper',
                ]"
                @click="choose(action)"
            >
                {{ action.label }}
            </button>
        </template>
    </BaseDropdown>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Ellipsis } from '@lucide/vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import type { RowAction } from '@/components/ui/row-actions';

/**
 * A row's action menu (#172): one 44px trigger named for the row
 * ("Actions for <label>") instead of a cluster of buttons. Picking an
 * item puts the focus back on the trigger before the action runs, so a
 * dialog it opens returns the focus there too.
 */
defineProps<{ label: string; actions: RowAction[] }>();

const open = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);

function choose(action: RowAction) {
    triggerRef.value?.focus();
    action.onSelect();
}
</script>
