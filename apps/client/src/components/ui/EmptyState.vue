<template>
    <div
        class="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center"
    >
        <span
            v-if="$slots.icon"
            class="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-leaf-50 text-leaf-700"
            aria-hidden="true"
        >
            <slot name="icon" />
        </span>
        <p class="text-base font-bold text-ink">{{ title }}</p>
        <p v-if="hint" class="max-w-sm text-sm text-muted">{{ hint }}</p>
        <div v-if="$slots.action" class="mt-2">
            <slot name="action" />
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; hint?: string }>();
</script>
