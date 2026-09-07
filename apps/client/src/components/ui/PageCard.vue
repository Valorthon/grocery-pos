<template>
    <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div
            v-if="title || $slots.actions"
            class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-slate-50 border-b border-slate-200"
        >
            <div class="flex items-center gap-2.5">
                <slot name="icon" />
                <h1 v-if="title" class="text-base font-bold text-slate-900">
                    {{ title }}
                </h1>
            </div>
            <div class="flex items-center gap-2">
                <slot name="actions" />
            </div>
        </div>
        <slot />
    </div>
</template>

<script setup lang="ts">
defineProps<{ title?: string }>();
</script>
