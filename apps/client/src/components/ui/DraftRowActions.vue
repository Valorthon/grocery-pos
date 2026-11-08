<template>
    <div class="flex justify-end gap-1">
        <button
            v-if="editable"
            type="button"
            class="inline-flex h-11 w-11 items-center justify-center rounded-control text-muted hover:text-leaf-700 hover:bg-leaf-50 disabled:opacity-40 focus-ring"
            :aria-label="editLabel"
            :disabled="disabled"
            @click="emit('edit')"
        >
            <Pencil class="w-4 h-4" aria-hidden="true" />
        </button>
        <button
            type="button"
            class="inline-flex h-11 w-11 items-center justify-center rounded-control text-muted hover:text-danger-fg hover:bg-danger-bg disabled:opacity-40 focus-ring"
            :aria-label="deleteLabel"
            :disabled="disabled"
            @click="emit('delete')"
        >
            <Trash2 class="w-4 h-4" aria-hidden="true" />
        </button>
    </div>
</template>

<script setup lang="ts">
import { Pencil, Trash2 } from '@lucide/vue';

/** A draft row's Edit and Delete, each a 44px target (#173). */
withDefaults(
    defineProps<{
        editable?: boolean;
        editLabel?: string;
        deleteLabel?: string;
        disabled?: boolean;
    }>(),
    {
        editable: true,
        editLabel: 'Edit draft',
        deleteLabel: 'Delete draft',
        disabled: false,
    },
);
const emit = defineEmits<{ edit: []; delete: [] }>();
</script>
