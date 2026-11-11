<template>
    <span
        class="inline-flex"
        @mouseenter="hovered = true"
        @mouseleave="
            hovered = false;
            dismissed = false;
        "
    >
        <button
            ref="trigger"
            type="button"
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted hover:text-ink focus-ring"
            :aria-label="label"
            :aria-describedby="tipId"
            data-info-tooltip
            @focus="focused = true"
            @blur="onBlur"
            @click="toggle"
        >
            <Info :size="16" aria-hidden="true" />
        </button>
        <!-- A manual popover sits in the top layer, so no overflow ancestor
             (a scrolling modal body, a table wrapper) clips it. It stays in
             the DOM so aria-describedby always resolves. -->
        <span
            :id="tipId"
            ref="tip"
            popover="manual"
            role="tooltip"
            data-tooltip
            :style="position"
            :class="[
                'fixed m-0 w-72 max-w-[80vw] rounded-control border border-line bg-surface p-3 text-left text-xs font-normal text-ink shadow-card',
                shown ? 'block' : 'hidden',
            ]"
        >
            <dl v-if="items?.length" class="space-y-2">
                <div v-for="item in items" :key="item.term">
                    <dt class="font-semibold">{{ item.term }}</dt>
                    <dd>{{ item.meaning }}</dd>
                </div>
            </dl>
            <slot />
        </span>
    </span>
</template>

<script setup lang="ts">
/*
 * A small ⓘ tooltip (#258). Opens on hover, on keyboard focus and on a tap
 * (click toggles it for touch). The note is a manual popover in the top
 * layer, placed under the button with JS-set positions (`:style`, never a
 * static style attribute: CSP, layout-drift.spec.ts), so overflow
 * containers never clip it. While it shows, Escape anywhere closes only
 * the tooltip (WCAG 1.4.13): a capture listener prevents the event, and the
 * modal stack ignores a prevented Escape. `items` renders a `<dl>` of
 * terms (column help, #263); the default slot holds free text.
 */
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { Info } from '@lucide/vue';

withDefaults(
    defineProps<{
        label?: string;
        items?: { term: string; meaning: string }[];
    }>(),
    { label: 'More information', items: undefined },
);

const WIDTH = 288,
    GAP = 4,
    EDGE = 8;
const tipId = useId();
const trigger = ref<HTMLButtonElement | null>(null),
    tip = ref<HTMLElement | null>(null);
const hovered = ref(false),
    focused = ref(false),
    pinned = ref(false),
    dismissed = ref(false),
    position = ref<Record<string, string>>({});
const shown = computed(
    () => !dismissed.value && (hovered.value || focused.value || pinned.value),
);

function place() {
    const rect = trigger.value?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(WIDTH, window.innerWidth * 0.8);
    const left = Math.max(
        EDGE,
        Math.min(rect.right - width, window.innerWidth - width - EDGE),
    );
    position.value = {
        top: `${rect.bottom + GAP}px`,
        left: `${left}px`,
        right: 'auto',
        bottom: 'auto',
    };
}
function onEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !shown.value) return;
    event.preventDefault();
    event.stopPropagation();
    dismissed.value = true;
    pinned.value = false;
}
function listen(on: boolean) {
    if (on) {
        window.addEventListener('keydown', onEscape, true);
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
    } else {
        window.removeEventListener('keydown', onEscape, true);
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
    }
}
/** Shows or hides the native popover where supported (jsdom has none). */
function popover(open: boolean) {
    const el = tip.value;
    if (!el || typeof el.showPopover !== 'function') return;
    try {
        if (open) el.showPopover();
        else el.hidePopover();
    } catch {
        // Already in that state.
    }
}
watch(shown, (open) => {
    if (open) place();
    popover(open);
    listen(open);
});
onBeforeUnmount(() => listen(false));

function toggle() {
    pinned.value = dismissed.value ? true : !pinned.value;
    dismissed.value = false;
}
function onBlur() {
    focused.value = false;
    pinned.value = false;
    dismissed.value = false;
}
</script>
