<template>
    <BaseButton
        variant="outline"
        class="min-h-11"
        data-date-range
        :aria-label="`Dates: ${text}`"
        aria-haspopup="dialog"
        :aria-expanded="open"
        @click="open = true"
    >
        <template #icon><CalendarDays :size="16" /></template>
        <span class="truncate">{{ text }}</span>
    </BaseButton>

    <BaseModal v-model="open" title="Dates" max-width="24rem">
        <div class="flex flex-col gap-3">
            <BaseSelect
                :id="idPrefix ? `${idPrefix}-preset` : undefined"
                :model-value="preset"
                label="Dates"
                :all-label="allowAll ? 'All dates' : ''"
                :options="DATE_PRESET_OPTIONS"
                @update:model-value="pickPreset"
            />
            <BaseInput
                :id="idPrefix ? `${idPrefix}-from` : undefined"
                :model-value="from"
                label="From"
                type="date"
                :max="limitRange ? to || undefined : undefined"
                @update:model-value="onDate('from', $event)"
                @change="onChange"
            />
            <BaseInput
                :id="idPrefix ? `${idPrefix}-to` : undefined"
                :model-value="to"
                :label="toLabel"
                type="date"
                :min="limitRange ? from || undefined : undefined"
                :error="error"
                @update:model-value="onDate('to', $event)"
                @change="onChange"
            />
        </div>
        <template #footer>
            <BaseButton class="ml-auto min-h-11" @click="open = false">
                Done
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
/*
 * One date-range control for a filter row (#254): a button naming the
 * preset or range that opens the presets plus From/To in a dialog on the
 * modal stack (Escape closes it, the focus returns to the button). The
 * page keeps #215's rules through useDatePreset: `preset` is a pick
 * (applies at once on page 1), `edit` is a hand edit (switches to Custom).
 * `editOn: 'change'` reports hand edits on the date input's change event
 * rather than on every input. The dialog stays open after a pick, so the
 * filled dates show; Done, Escape or × close it.
 */
import { computed, ref } from 'vue';
import { CalendarDays } from '@lucide/vue';
import BaseButton from './BaseButton.vue';
import BaseInput from './BaseInput.vue';
import BaseModal from './BaseModal.vue';
import BaseSelect from './BaseSelect.vue';
import { dateRangeLabel } from './date-range-label';
import {
    DATE_PRESET_OPTIONS,
    type DatePreset,
} from '@/views/User/Reports/presets';

const props = withDefaults(
    defineProps<{
        preset: DatePreset | null;
        from: string;
        to: string;
        /** The reversed-range message under To (`dateRangeError`). */
        error?: string;
        editOn?: 'input' | 'change';
        /** Sets each input's min/max from the other date. */
        limitRange?: boolean;
        /** Ids `<prefix>-preset`, `-from` and `-to` for the dialog fields. */
        idPrefix?: string;
        toLabel?: string;
        /** Offers "All dates" (no preset); Reports always has a range. */
        allowAll?: boolean;
    }>(),
    {
        error: '',
        editOn: 'input',
        limitRange: true,
        idPrefix: '',
        toLabel: 'To',
        allowAll: true,
    },
);

const emit = defineEmits<{
    (e: 'update:from', value: string): void;
    (e: 'update:to', value: string): void;
    (e: 'preset', value: DatePreset | null): void;
    (e: 'edit'): void;
}>();

const open = ref(false);
const text = computed(() => dateRangeLabel(props.preset, props.from, props.to));

function pickPreset(value: string | null) {
    emit('preset', value as DatePreset | null);
}
function onDate(which: 'from' | 'to', value: string) {
    if (which === 'from') emit('update:from', value);
    else emit('update:to', value);
    if (props.editOn === 'input') emit('edit');
}
function onChange() {
    if (props.editOn === 'change') emit('edit');
}
</script>
