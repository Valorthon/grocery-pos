<template>
    <span v-if="placement === 'under'" class="mt-1 block sm:hidden"
        ><Badge :color="entry.color">{{ entry.label }}</Badge></span
    >
    <Badge v-else :color="entry.color">{{ entry.label }}</Badge>
</template>

<script setup lang="ts" generic="S extends string">
import { computed } from 'vue';
import Badge from './Badge.vue';
import type { StatusMap } from './status-badge';

const props = withDefaults(
    defineProps<{
        status: S;
        map: StatusMap<S>;
        /** `under`: below `sm` only, under a figure whose column hides (#242). */
        placement?: 'inline' | 'under';
    }>(),
    { placement: 'inline' },
);

const entry = computed(() => props.map[props.status]);
</script>
