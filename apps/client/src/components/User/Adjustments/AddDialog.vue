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
                @search="onSearch"
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
    matches,
    options: matchOptions,
    loading: isLoadingMatches,
    error: searchError,
    debouncedSearch,
    reset: resetMatches,
} = useProductMatches();

/** The product picked from the matches, as it was when picked. */
interface PickedProduct {
    product: string;
    name: string;
    EAN: string;
}

/**
 * Only a pick sets this, and only the pick's own snapshot is shown or
 * sent; typing in the search box clears it (issue #17).
 */
const picked = ref<PickedProduct | null>(null);

const selectedProduct = computed<ComboboxOption | null>({
    get: () =>
        picked.value
            ? {
                  value: picked.value.product,
                  label: picked.value.name,
                  subtitle: `EAN: ${picked.value.EAN}`,
              }
            : null,
    set: (opt) => {
        const match = opt
            ? matches.value.find((m) => m.product === opt.value)
            : undefined;
        picked.value = opt
            ? {
                  product: opt.value,
                  name: opt.label,
                  EAN: match?.EAN ?? opt.display ?? '',
              }
            : null;
        clearError('EAN');
    },
});

function clearError(...fields: string[]) {
    const next = { ...errors.value };
    for (const field of fields) delete next[field];
    errors.value = next;
}

function onSearch(query: string) {
    clearError('EAN');
    debouncedSearch(query);
}

watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        const item = props.item;
        formData.EAN = item?.EAN ?? '';
        formData.name = '';
        formData.change = item?.change ?? '';
        formData.reason = item?.reason ?? '';
        formData.product = '';
        picked.value = item?.product
            ? { product: item.product, name: item.name, EAN: item.EAN }
            : null;
        errors.value = {};
        resetMatches();
    },
);

function handleSubmit() {
    errors.value = adjustmentLineErrors({
        ...formData,
        product: picked.value?.product ?? '',
    });
    if (Object.keys(errors.value).length || !picked.value) return;
    const payload: AddForm = {
        EAN: picked.value.EAN,
        name: picked.value.name,
        product: picked.value.product,
        change: Number(formData.change),
        reason: formData.reason,
    };
    if (isEditMode.value) emit('update', payload);
    else emit('add', payload);
    model.value = false;
}
</script>
