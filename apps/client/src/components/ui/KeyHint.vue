<template>
    <!--
        A key shown on a button (issue #22). Hidden from screen readers: the
        button carries the key in `aria-keyshortcuts` instead.
    -->
    <kbd
        aria-hidden="true"
        data-key-hint
        :class="[
            'inline-flex items-center rounded-sm border px-1.5 font-mono text-xs font-bold leading-4 not-italic',
            tone === 'dark'
                ? 'border-white/30 bg-white/10 text-white/80'
                : 'border-line-strong bg-surface text-muted',
        ]"
        ><slot
    /></kbd>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'light' | 'dark' }>(), { tone: 'light' });
</script>
