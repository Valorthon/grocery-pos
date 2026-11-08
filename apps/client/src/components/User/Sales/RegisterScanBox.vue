<template>
    <form
        class="mt-3 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center"
        @submit.prevent="emit('submit')"
    >
        <div
            class="flex items-center bg-surface border border-line-strong rounded-card pl-3 pr-1 py-1 shrink-0"
        >
            <span
                class="text-xs font-bold text-muted uppercase tracking-wider mr-2"
                >Qty:</span
            >
            <select
                v-model.number="multiplier"
                aria-label="Quantity per scan"
                class="num min-h-11 min-w-11 px-1 bg-transparent text-ink font-bold text-sm cursor-pointer rounded focus-ring"
                @change="emit('multiplier-change')"
            >
                <option v-for="q in qtyOptions" :key="q" :value="q">
                    {{ q }}x
                </option>
            </select>
        </div>

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
                :aria-activedescendant="
                    highlighted === -1
                        ? undefined
                        : `product-match-${highlighted}`
                "
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
                @keydown.down.prevent="emit('move', 1)"
                @keydown.up.prevent="emit('move', -1)"
                @keydown.esc="emit('unhighlight')"
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
        The multiplier applies to the next scan only (decision
        2026-09-25, #23), whether set with the Qty picker or
        typed as "12*".
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
 * The register's scan box (#163): the Qty picker, the scan/search input,
 * the next-scan badge and the scan result regions. State lives in Sell.vue.
 */
import { useTemplateRef } from 'vue';
import { AlertCircle, Barcode, CheckCircle2, X } from '@lucide/vue';
import KeyHint from '@/components/ui/KeyHint.vue';
import { REGISTER_KEYS } from '@/composables/useRegisterShortcuts';

defineProps<{
    locked: boolean;
    qtyOptions: readonly number[];
    matchCount: number;
    highlighted: number;
    nextScanQty: number;
    scanFeedback: { type: 'success' | 'error'; message: string } | null;
}>();
const query = defineModel<string>({ required: true });
const multiplier = defineModel<number>('multiplier', { required: true });
const emit = defineEmits<{
    submit: [];
    'multiplier-change': [];
    'search-change': [];
    move: [delta: number];
    unhighlight: [];
    clear: [];
}>();

const input = useTemplateRef<HTMLInputElement>('input');
defineExpose({ input });
</script>
