<template>
    <span class="block">{{ name }}</span
    ><span
        v-if="ean"
        class="block text-xs text-muted font-normal num"
        data-testid="row-ean"
        >{{ ean }}</span
    >
</template>

<script setup lang="ts">
/** A product's name as typed, its EAN muted below (#232, #242). */
defineProps<{ name: string; ean?: string }>();
</script>
