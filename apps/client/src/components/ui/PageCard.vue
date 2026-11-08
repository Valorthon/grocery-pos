<template>
    <section
        class="bg-white rounded-2xl border border-slate-200 overflow-hidden"
        :aria-labelledby="heading ? headingId : undefined"
    >
        <h2
            v-if="heading"
            :id="headingId"
            class="px-5 pt-5 font-display text-lg font-bold text-ink"
        >
            {{ heading }}
        </h2>
        <slot />
    </section>
</template>

<script setup lang="ts">
import { useId } from 'vue';

/**
 * A plain content section (#159). The page title lives in `PageFrame`'s
 * PageHeader; `heading` names a section when a page has several.
 */
defineProps<{ heading?: string }>();
const headingId = useId();
</script>
