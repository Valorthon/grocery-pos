<template>
    <form
        class="mt-3 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center"
        @submit.prevent="emit('submit')"
    >
        <div
            class="flex items-center bg-slate-50 border border-slate-300 rounded-xl pl-3 pr-1 py-1 shrink-0"
        >
            <span
                class="text-xs font-bold text-slate-500 uppercase tracking-wider mr-2"
                >Qty:</span
            >
            <select
                v-model.number="multiplier"
                aria-label="Quantity per scan"
                class="min-h-11 min-w-11 px-1 bg-transparent text-slate-900 font-extrabold text-sm cursor-pointer rounded focus-ring"
                @change="emit('multiplier-change')"
            >
                <option v-for="q in qtyOptions" :key="q" :value="q">
                    {{ q }}x
                </option>
            </select>
        </div>

        <div class="relative flex-1">
            <div
                class="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-slate-400"
            >
                <Barcode class="w-5 h-5 text-slate-600" />
            </div>
            <input
                ref="input"
                v-model="query"
                :disabled="locked"
                type="text"
                placeholder="Scan barcode, enter EAN, or search item..."
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
                class="w-full min-h-14 pl-11 py-3 bg-slate-50 text-slate-900 placeholder-slate-400 text-sm font-mono font-bold rounded-xl border border-slate-300 focus:border-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none transition-all"
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
                    class="min-h-11 min-w-11 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg focus-ring"
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
                    class="min-h-11 min-w-11 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold uppercase rounded-lg shadow-2xs transition-colors active:scale-[0.98] focus-ring"
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
            class="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-sm font-extrabold"
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
            class="mt-2.5 p-2.5 rounded-xl flex items-center gap-2 text-sm font-bold bg-emerald-50 border border-emerald-200 text-emerald-800"
        >
            <CheckCircle2
                class="w-4 h-4 text-emerald-600 shrink-0"
                aria-hidden="true"
            />
            <span>{{ scanFeedback.message }}</span>
        </div>
    </div>
    <div role="alert" aria-live="assertive" data-testid="scan-alert">
        <div
            v-if="scanFeedback?.type === 'error'"
            class="mt-2.5 p-2.5 rounded-xl flex items-center gap-2 text-sm font-bold bg-red-50 border border-red-200 text-red-800"
        >
            <AlertCircle
                class="w-4 h-4 text-red-600 shrink-0"
                aria-hidden="true"
            />
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
