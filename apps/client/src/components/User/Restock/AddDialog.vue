<template>
    <BaseModal
        v-model="model"
        :title="isEditMode ? 'Edit Restock Entry' : 'Add Restock Entry'"
        subtitle="Search an existing product or add a new one"
        max-width="32rem"
        scrollable
    >
        <div class="space-y-4">
            <template v-if="formData.isNewProduct">
                <BaseInput
                    v-model="formData.EAN"
                    label="EAN"
                    inputmode="numeric"
                    autocomplete="off"
                    :maxlength="STRING_LIMITS.EAN"
                    :disabled="formData.autoGenerateEAN"
                    :error="errors.EAN"
                />
                <BaseCheckbox
                    v-model="formData.autoGenerateEAN"
                    label="Auto-generate EAN"
                />
            </template>
            <template v-else>
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
            </template>

            <div class="grid grid-cols-2 gap-4">
                <BaseInput
                    v-model.number="formData.quantity"
                    label="Quantity"
                    type="number"
                    inputmode="numeric"
                    :min="NUMERIC_LIMITS.QUANTITY_MIN"
                    step="1"
                    :error="errors.quantity"
                />
                <BaseInput
                    v-model="formData.unitCost"
                    label="Unit Cost (₱)"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="0.00"
                    :error="errors.unitCost"
                />
            </div>

            <BaseCheckbox
                v-model="formData.isNewProduct"
                label="This is a new product"
            />

            <template v-if="formData.isNewProduct">
                <BaseInput
                    v-model="formData.name"
                    label="Product Name"
                    :maxlength="STRING_LIMITS.PRODUCT_NAME"
                    :error="errors.name"
                />
                <BaseInput
                    v-model="formData.price"
                    label="Selling Price (₱)"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="0.00"
                    :error="errors.price"
                />
            </template>
        </div>

        <template #footer>
            <BaseButton variant="outline" @click="model = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" @click="handleSubmit">
                <Save v-if="isEditMode" class="w-4 h-4" />
                <Plus v-else class="w-4 h-4" />
                {{ isEditMode ? 'Update Restock' : 'Restock' }}
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Plus, Save } from '@lucide/vue';
import api from '@/axios';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import type { ComboboxOption } from '@/components/ui/BaseCombobox.vue';
import { AddForm, AddFormInput } from './dto';
import { restockLineErrors } from './validation';
import { Color, useUIStore } from '@/stores/ui';
import { NUMERIC_LIMITS, STRING_LIMITS } from '@grocery-pos/contracts';
import { centavosToPesoInput, pesosToCentavos } from '@/utils/currency';
import { apiErrorMessages } from '@/utils/api-error';
import { toEnsureValidQuery } from '@/utils/payloads';
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

const uiStore = useUIStore();
const formData = reactive<AddFormInput>({
    autoGenerateEAN: false,
    EAN: '',
    quantity: '',
    unitCost: '',
    isNewProduct: false,
    name: '',
    price: '',
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
        const item = props.item;
        formData.autoGenerateEAN = item?.autoGenerateEAN ?? false;
        formData.EAN = item?.EAN ?? '';
        formData.quantity = item?.quantity ?? '';
        formData.unitCost =
            item?.unitCost != null ? centavosToPesoInput(item.unitCost) : '';
        formData.product = item?.product ?? '';
        formData.isNewProduct = item?.isNewProduct ?? false;
        formData.name = item?.name ?? '';
        formData.price = item?.price ? centavosToPesoInput(item.price) : '';
        errors.value = {};
        resetMatches();
    },
);

const handleSubmit = async () => {
    errors.value = restockLineErrors(formData);
    if (Object.keys(errors.value).length) return;

    if (formData.isNewProduct) {
        try {
            await api.get('products/ensureValid', {
                params: toEnsureValidQuery(formData),
            });
        } catch (err) {
            apiErrorMessages(err, 'Could not check the product').forEach(
                (msg) => uiStore.queueMessage(Color.ERROR, msg),
            );
            return;
        }
    }

    const payload: AddForm = {
        ...formData,
        quantity: Number(formData.quantity),
        unitCost: pesosToCentavos(formData.unitCost),
        price: formData.isNewProduct
            ? pesosToCentavos(formData.price)
            : undefined,
    };
    if (isEditMode.value) emit('update', payload);
    else emit('add', payload);
    model.value = false;
};
</script>
