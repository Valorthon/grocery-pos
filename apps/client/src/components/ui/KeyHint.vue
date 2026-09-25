<template>
    <!--
        A key shown on a button (issue #22). Hidden from screen readers: the
        button carries the key in `aria-keyshortcuts` instead.
    -->
    <kbd
        aria-hidden="true"
        data-key-hint
        :class="[
            'inline-flex items-center rounded-md border px-1.5 font-mono text-[10px] font-bold leading-4 not-italic',
            tone === 'dark'
                ? 'border-white/30 bg-white/10 text-white/80'
                : 'border-slate-300 bg-white text-slate-500',
        ]"
        ><slot
    /></kbd>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'light' | 'dark' }>(), { tone: 'light' });
</script>
