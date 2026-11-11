<template>
    <span
        class="relative inline-flex"
        @mouseenter="hovered = true"
        @mouseleave="
            hovered = false;
            dismissed = false;
        "
    >
        <button
            type="button"
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted hover:text-ink focus-ring"
            :aria-label="label"
            :aria-describedby="tipId"
            :aria-expanded="shown"
            data-info-tooltip
            @focus="focused = true"
            @blur="onBlur"
            @click="toggle"
            @keydown.esc="onEscape"
        >
            <Info :size="16" aria-hidden="true" />
        </button>
        <!-- Always in the DOM so aria-describedby resolves; hidden by class. -->
        <span
            :id="tipId"
            role="tooltip"
            data-tooltip
            :class="[
                'absolute top-full right-0 z-10 mt-1 w-72 max-w-[80vw] rounded-control border border-line bg-surface p-3 text-xs font-normal text-ink shadow-card',
                shown ? 'block' : 'hidden',
            ]"
        >
            <slot />
        </span>
    </span>
</template>

<script setup lang="ts">
/*
 * A small ⓘ tooltip (#258). Opens on hover, on keyboard focus and on a tap
 * (click toggles it for touch). Escape closes it without reaching the modal
 * stack. Classes only, no inline style (CSP, layout-drift.spec.ts).
 */
import { computed, ref, useId } from 'vue';
import { Info } from '@lucide/vue';

withDefaults(defineProps<{ label?: string }>(), { label: 'More information' });

const tipId = useId();
const hovered = ref(false),
    focused = ref(false),
    pinned = ref(false),
    dismissed = ref(false);
const shown = computed(
    () => !dismissed.value && (hovered.value || focused.value || pinned.value),
);

function onBlur() {
    focused.value = false;
    pinned.value = false;
    dismissed.value = false;
}
function toggle() {
    pinned.value = dismissed.value ? true : !pinned.value;
    dismissed.value = false;
}
function onEscape(event: KeyboardEvent) {
    if (!shown.value) return;
    event.stopPropagation();
    dismissed.value = true;
    pinned.value = false;
}
</script>
