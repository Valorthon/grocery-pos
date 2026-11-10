<template>
    <BaseButton
        size="sm"
        variant="ghost"
        class="-my-2 min-h-11 min-w-11 w-11 h-11 p-0"
        :aria-label="label"
        @click="emit('open')"
        ><slot><ChevronRight class="w-5 h-5" aria-hidden="true" /></slot
    ></BaseButton>
</template>

<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';
import BaseButton from './BaseButton.vue';

/** A row's trailing 44×44 open button (#232, #242); the slot sets the icon. */
defineProps<{ label: string }>();
const emit = defineEmits<{ (e: 'open'): void }>();
</script>
