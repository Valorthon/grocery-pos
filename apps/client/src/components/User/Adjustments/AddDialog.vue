<template>
    <BaseModal
        v-model="model"
        :title="isEditMode ? 'Edit Adjustment' : 'Adjust Stock'"
        subtitle="Search a product and set the stock change"
        max-width="28rem"
        scrollable
    >
        <div class="space-y-4">
            <BaseCombobox
                v-model="formData.EAN"
                v-model:selected="selectedProduct"
                :options="matchOptions"
                label="Search Product (EAN or Name)"
                placeholder="Start typing..."
                :maxlength="STRING_LIMITS.PRODUCT_NAME"
                :loading="isLoadingMatches"
                :error="errors.EAN || searchError"
                @search="debouncedSearch"
            />

            <!-- No inputmode: a numeric keypad has no minus key, and a
                 write-off is a negative change. -->
            <BaseInput
                v-model.number="formData.change"
                label="Change"
                type="number"
                step="1"
                placeholder="e.g. 5 or -2"
                :error="errors.change"
            />

            <div>
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5"
                    >Reason</label
                >
                <textarea
                    v-model="formData.reason"
                    :maxlength="STRING_LIMITS.REASON"
                    rows="3"
                    class="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-slate-50 text-sm focus:outline-none focus:border-primary-600 focus:bg-white resize-none transition-all"
                />
                <p v-if="errors.reason" class="mt-1 text-xs text-red-600">
                    {{ errors.reason }}
                </p>
            </div>
        </div>

        <template #footer>
            <BaseButton variant="outline" @click="model = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" @click="handleSubmit">
                <Save v-if="isEditMode" class="w-4 h-4" />
                <Plus v-else class="w-4 h-4" />
                {{ isEditMode ? 'Update Adjustment' : 'Adjust' }}
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Plus, Save } from '@lucide/vue';
import { STRING_LIMITS } from '@grocery-pos/contracts';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import type { ComboboxOption } from '@/components/ui/BaseCombobox.vue';
import { AddForm, AddFormInput } from './dto';
import { adjustmentLineErrors } from './validation';
import { useProductMatches } from '@/composables/useProductMatches';

const props = defineProps<{ modelValue: boolean; item?: AddForm }>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'add', payload: AddForm): void;
    (e: 'update', payload: AddForm): void;
}>();

const model = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const formData = reactive<AddFormInput>({
    EAN: '',
    name: '',
    change: '',
    reason: '',
    product: '',
});

const errors = ref<Record<string, string>>({});
const isEditMode = computed(
    () => !!props.item && Object.keys(props.item).length > 0,
);

const {
    options: matchOptions,
    loading: isLoadingMatches,
    error: searchError,
    debouncedSearch,
    reset: resetMatches,
} = useProductMatches();

/**
 * The picked product, shown under the search box. Picking sets the line's
 * product id and name (the combobox writes its EAN back into the box);
 * typing afterwards clears both, so a stale id never rides along with
 * different text.
 */
const selectedProduct = computed<ComboboxOption | null>({
    get: () =>
        formData.product
            ? {
                  value: formData.product,
                  label: formData.name,
                  subtitle: `EAN: ${formData.EAN}`,
              }
            : null,
    set: (opt) => {
        formData.product = opt?.value ?? '';
        formData.name = opt?.label ?? '';
    },
});

watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        formData.EAN = props.item?.EAN ?? '';
        formData.name = props.item?.name ?? '';
        formData.change = props.item?.change ?? '';
        formData.reason = props.item?.reason ?? '';
        formData.product = props.item?.product ?? '';
        errors.value = {};
        resetMatches();
    },
);

function handleSubmit() {
    errors.value = adjustmentLineErrors(formData);
    if (Object.keys(errors.value).length) return;
    const payload: AddForm = { ...formData, change: Number(formData.change) };
    if (isEditMode.value) emit('update', payload);
    else emit('add', payload);
    model.value = false;
}
</script>
