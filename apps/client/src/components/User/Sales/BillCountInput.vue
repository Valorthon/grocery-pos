<template>
    <div class="space-y-5">
        <div v-for="group in groups" :key="group.key" class="space-y-2">
            <div
                class="flex items-center justify-between pb-1 border-b border-slate-200"
            >
                <div
                    class="flex items-center gap-1.5 text-xs font-extrabold text-slate-800 uppercase tracking-wider"
                >
                    <component
                        :is="group.icon"
                        class="w-4 h-4"
                        :class="group.iconClass"
                    />
                    <span>{{ group.title }}</span>
                </div>
                <span class="font-mono text-xs font-bold text-slate-600">
                    {{ format(group.subtotal, group.kind === 'bills' ? 0 : 2) }}
                </span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                <div
                    v-for="d in group.denoms"
                    :key="d.id"
                    class="p-3 rounded-2xl border-2 transition-all flex flex-col justify-between gap-3"
                    :class="tileClass(group.kind, count(d.id) > 0)"
                >
                    <div
                        class="flex flex-col items-center justify-center gap-1.5 min-h-[92px]"
                    >
                        <div
                            class="flex items-center justify-center py-1"
                            :class="group.kind === 'bills' ? 'w-full' : ''"
                        >
                            <DenominationIcon
                                :id="d.id"
                                class="object-contain drop-shadow-md"
                                :class="
                                    group.kind === 'bills'
                                        ? 'w-full max-w-[170px] h-14'
                                        : 'w-14 h-14'
                                "
                            />
                        </div>
                        <div class="h-5 flex items-center justify-center">
                            <span
                                v-if="count(d.id) > 0"
                                class="font-mono text-xs font-black"
                                :class="group.subtotalClass"
                            >
                                {{
                                    format(
                                        count(d.id) * d.value,
                                        group.kind === 'bills' ? 0 : 2,
                                    )
                                }}
                                <span
                                    class="text-[11px] font-bold"
                                    :class="group.countClass"
                                >
                                    ({{ count(d.id) }}
                                    {{ count(d.id) === 1 ? 'pc' : 'pcs' }})
                                </span>
                            </span>
                            <span
                                v-else
                                class="text-[11px] text-slate-400 font-medium"
                                >0 pcs</span
                            >
                        </div>
                    </div>

                    <div
                        class="flex items-center justify-between gap-1 bg-white border border-slate-300 rounded-xl p-1 shadow-2xs"
                    >
                        <button
                            type="button"
                            class="w-8 h-8 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:bg-slate-200 rounded-lg disabled:opacity-30 text-sm font-black transition-colors"
                            :disabled="count(d.id) <= 0"
                            @click="adjust(d.id, -1)"
                        >
                            <Minus class="w-4 h-4" />
                        </button>
                        <input
                            type="number"
                            min="0"
                            class="w-14 text-center font-mono font-black text-sm text-slate-900 focus:outline-none"
                            :value="count(d.id) === 0 ? '' : count(d.id)"
                            placeholder="0"
                            @change="set(d.id, $event)"
                        />
                        <button
                            type="button"
                            class="w-8 h-8 flex items-center justify-center rounded-lg text-sm font-black transition-colors"
                            :class="group.plusClass"
                            @click="adjust(d.id, 1)"
                        >
                            <Plus class="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Banknote, Coins, Minus, Plus } from '@lucide/vue';
import DenominationIcon from './DenominationIcon.vue';
import { COIN_DENOMINATIONS, PAPER_DENOMINATIONS } from './shift';
import type { BillCounts } from './shift';

const props = defineProps<{
    modelValue: BillCounts;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: BillCounts): void;
}>();

const groups = computed(() => [
    {
        key: 'bills',
        kind: 'bills',
        title: 'Bills',
        icon: Banknote,
        iconClass: 'text-primary-600',
        subtotalClass: 'text-primary-950',
        countClass: 'text-primary-600',
        plusClass: 'text-primary-700 hover:bg-primary-50 active:bg-primary-100',
        denoms: PAPER_DENOMINATIONS,
        subtotal: subtotal(PAPER_DENOMINATIONS),
    },
    {
        key: 'coins',
        kind: 'coins',
        title: 'Coins',
        icon: Coins,
        iconClass: 'text-amber-600',
        subtotalClass: 'text-amber-950',
        countClass: 'text-amber-700',
        plusClass: 'text-amber-700 hover:bg-amber-50 active:bg-amber-100',
        denoms: COIN_DENOMINATIONS,
        subtotal: subtotal(COIN_DENOMINATIONS),
    },
]);

function count(id: string): number {
    return props.modelValue[id] ?? 0;
}

function subtotal(denoms: typeof PAPER_DENOMINATIONS): number {
    return denoms.reduce(
        (sum, d) => sum + (props.modelValue[d.id] ?? 0) * d.value,
        0,
    );
}

function tileClass(kind: string, active: boolean): string {
    if (!active) {
        return 'bg-slate-50/90 border-slate-200 hover:border-slate-300';
    }
    return kind === 'bills'
        ? 'bg-primary-50/90 border-primary-300'
        : 'bg-amber-50/90 border-amber-400';
}

function adjust(id: string, delta: number) {
    const next = { ...props.modelValue, [id]: Math.max(0, count(id) + delta) };
    emit('update:modelValue', next);
}

function set(id: string, event: Event) {
    const target = event.target as HTMLInputElement;
    const parsed = parseInt(target.value, 10);
    const next = {
        ...props.modelValue,
        [id]: Number.isNaN(parsed) || parsed < 0 ? 0 : parsed,
    };
    emit('update:modelValue', next);
}

function format(value: number, decimals: number): string {
    return `₱${value.toLocaleString('en-PH', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    })}`;
}
</script>
