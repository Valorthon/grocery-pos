<template>
    <BaseDropdown
        v-model="open"
        align="right"
        width-class="w-48"
        floating
        class="flex justify-end"
        data-row-actions-root
    >
        <template #trigger="{ trigger }">
            <button
                ref="triggerRef"
                v-bind="trigger"
                data-row-actions
                class="w-11 h-11 rounded-control flex items-center justify-center text-muted hover:bg-line transition-colors focus-ring"
                :aria-label="`Actions for ${label}`"
                :title="`Actions for ${label}`"
            >
                <Ellipsis class="w-5 h-5" aria-hidden="true" />
            </button>
        </template>
        <template #menu>
            <button
                v-for="(action, i) in actions"
                :key="action.label"
                type="button"
                role="menuitem"
                :disabled="action.disabled && !action.reason"
                :aria-disabled="
                    action.disabled && action.reason ? 'true' : undefined
                "
                :aria-describedby="
                    action.reason ? `${reasonId}-${i}` : undefined
                "
                :class="[
                    'w-full min-h-11 px-3 py-1 rounded-lg flex flex-col justify-center items-start text-left text-sm font-semibold transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
                    action.danger
                        ? 'text-danger-fg hover:bg-danger-bg'
                        : 'text-ink hover:bg-paper',
                ]"
                @click="choose(action)"
            >
                {{ action.label }}
                <span
                    v-if="action.reason"
                    :id="`${reasonId}-${i}`"
                    class="text-xs font-normal text-muted"
                    data-row-action-reason
                    >{{ action.reason }}</span
                >
            </button>
        </template>
    </BaseDropdown>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, useId } from 'vue';
import { Ellipsis } from '@lucide/vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import type { RowAction } from '@/components/ui/row-actions';
import { focusPage } from '@/components/ui/modal-stack';

/**
 * A row's action menu (#172): one 44px trigger named for the row
 * ("Actions for <label>") instead of a cluster of buttons. Picking an
 * item puts the focus back on the trigger before the action runs, so a
 * dialog it opens returns the focus there too. If the row then goes
 * away (archived out of the filter, deleted, or the table reloading),
 * the focus moves to the trigger now at the same position (the next
 * row's), else to the table, else the page's `<main>`.
 */
defineProps<{ label: string; actions: RowAction[] }>();

const open = ref(false);
/** Ties a disabled item's reason to it, so it stays focusable and is announced. */
const reasonId = useId();
const triggerRef = ref<HTMLButtonElement | null>(null);

/** The trigger's position among the table's, taken when an item is picked. */
let index = -1;

function choose(action: RowAction) {
    if (action.disabled) return;
    const trigger = triggerRef.value;
    const table = trigger?.closest('table');
    index =
        trigger && table
            ? [
                  ...table.querySelectorAll<HTMLElement>('[data-row-actions]'),
              ].indexOf(trigger)
            : -1;
    trigger?.focus();
    action.onSelect();
}

const SETTLE_MS = 5000;

onBeforeUnmount(() => {
    const trigger = triggerRef.value;
    if (!trigger || document.activeElement !== trigger) return;
    const table = trigger.closest('table');
    const holder = table?.parentElement;
    if (!table || !holder || index < 0) return;
    // Hold the focus on the table's box until rows are back.
    if (!holder.hasAttribute('tabindex')) holder.setAttribute('tabindex', '-1');
    queueMicrotask(() => {
        if (!holder.isConnected) return;
        holder.focus({ preventScroll: true });
        if (document.activeElement !== holder) {
            focusPage();
            return;
        }
        const settle = () => {
            if (document.activeElement !== holder) return true;
            const rows = [
                ...holder.querySelectorAll<HTMLElement>('[data-row-actions]'),
            ];
            if (!rows.length) return false;
            rows[Math.min(index, rows.length - 1)].focus();
            return true;
        };
        if (settle()) return;
        const observer = new MutationObserver(() => {
            if (settle()) stop();
        });
        const timer = setTimeout(() => stop(), SETTLE_MS);
        function stop() {
            observer.disconnect();
            clearTimeout(timer);
        }
        observer.observe(holder, { childList: true, subtree: true });
    });
});
</script>
