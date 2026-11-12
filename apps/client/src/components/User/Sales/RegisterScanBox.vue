<template>
    <form class="mt-3" @submit.prevent="emit('submit')">
        <div class="relative flex-1">
            <div
                class="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-leaf-600 pointer-events-none"
            >
                <Barcode class="w-6 h-6" aria-hidden="true" />
            </div>
            <input
                ref="input"
                v-model="query"
                :disabled="locked"
                type="text"
                placeholder="Scan barcode, enter EAN, or search item…"
                data-testid="scan-input"
                aria-label="Scan barcode or search items"
                :aria-keyshortcuts="REGISTER_KEYS.SCAN"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="product-matches"
                :aria-expanded="matchCount > 0"
                :class="
                    /*
                     * Room for the buttons on the right (#89):
                     * Enter / Scan, plus Clear with text, plus
                     * the F2 hint from sm up.
                     */
                    query ? 'pr-43 sm:pr-52' : 'pr-32 sm:pr-48'
                "
                class="w-full min-h-14 pl-12 py-3 bg-surface text-ink placeholder:text-muted text-base font-mono font-bold rounded-card border-2 border-line-strong shadow-card focus:border-leaf-600 focus:outline-3 focus:outline-offset-0 focus:outline-leaf-500 disabled:opacity-60 transition-colors"
                @input="emit('search-change')"
                @keydown.down="onDown"
            />
            <div
                class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1"
            >
                <button
                    v-if="query"
                    type="button"
                    aria-label="Clear search"
                    class="min-h-11 min-w-11 flex items-center justify-center text-muted hover:text-ink hover:bg-paper rounded-control focus-ring"
                    @click="emit('clear')"
                >
                    <X class="w-4 h-4" aria-hidden="true" />
                </button>
                <!-- Hidden on phones, for the text's room (#89). -->
                <span class="hidden sm:inline-flex" data-testid="scan-key-hint">
                    <KeyHint>{{ REGISTER_KEYS.SCAN }}</KeyHint>
                </span>
                <button
                    type="submit"
                    :disabled="locked"
                    class="min-h-11 min-w-11 px-3.5 py-2 bg-leaf-600 hover:bg-leaf-700 active:bg-leaf-800 disabled:opacity-40 text-white text-xs font-bold uppercase rounded-control shadow-card transition-colors active:scale-[0.98] focus-ring"
                >
                    Enter / Scan
                </button>
            </div>
        </div>
    </form>

    <!--
        A typed "12*" multiplies the next scan or pick only (#23);
        the Qty picker is gone (#323).
    -->
    <div role="status" aria-live="polite">
        <p
            v-if="nextScanQty > 1"
            data-testid="multiplier-badge"
            class="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full num bg-warning-bg border border-warning-border text-warning-fg text-sm font-bold"
        >
            ×{{ nextScanQty }} on next scan
        </p>
    </div>

    <!--
        Scan results are announced (#23): a success politely and
        it fades; an error assertively and it stays until the
        next scan. Both regions are always present, so a screen
        reader hears what appears in them.
    -->
    <div role="status" aria-live="polite" data-testid="scan-status">
        <div
            v-if="scanFeedback?.type === 'success'"
            class="mt-2.5 p-2.5 rounded-card flex items-center gap-2 text-sm font-bold bg-success-bg border border-success-border text-success-fg"
        >
            <CheckCircle2 class="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{{ scanFeedback.message }}</span>
        </div>
    </div>
    <div role="alert" aria-live="assertive" data-testid="scan-alert">
        <div
            v-if="scanFeedback?.type === 'error'"
            class="mt-2.5 p-2.5 rounded-card flex items-center gap-2 text-sm font-bold bg-danger-bg border border-danger-border text-danger-fg"
        >
            <AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{{ scanFeedback.message }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * The register's scan box (#163): the scan/search input,
 * the next-scan badge and the scan result regions. State lives in Sell.vue.
 */
import { useTemplateRef } from 'vue';
import { AlertCircle, Barcode, CheckCircle2, X } from '@lucide/vue';
import KeyHint from '@/components/ui/KeyHint.vue';
import { REGISTER_KEYS } from '@/composables/useRegisterShortcuts';

const props = defineProps<{
    locked: boolean;
    matchCount: number;
    /** The matches answer the current text (`settled`), #322 review. */
    matchesSettled: boolean;
    nextScanQty: number;
    scanFeedback: { type: 'success' | 'error'; message: string } | null;
}>();
const query = defineModel<string>({ required: true });
const emit = defineEmits<{
    submit: [];
    'search-change': [];
    /** ↓ with matches listed: the focus goes to the first one (#322). */
    'enter-matches': [];
    clear: [];
}>();

function onDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
    }
    if (event.isComposing || props.matchCount === 0) return;
    // A list for older text can't be entered; ↓ does nothing until it is.
    event.preventDefault();
    if (!props.matchesSettled) return;
    emit('enter-matches');
}

const input = useTemplateRef<HTMLInputElement>('input');
defineExpose({ input });
</script>
