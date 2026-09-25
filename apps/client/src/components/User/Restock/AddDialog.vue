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
                    @search="onSearch"
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
                :model-value="formData.isNewProduct"
                label="This is a new product"
                @update:model-value="setNewProduct"
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
    matches,
    options: matchOptions,
    loading: isLoadingMatches,
    error: searchError,
    debouncedSearch,
    reset: resetMatches,
} = useProductMatches();

/** The existing product picked from the matches, as it was when picked. */
interface PickedProduct {
    product: string;
    name: string;
    EAN: string;
}

/**
 * Only a pick sets this, and only the pick's own snapshot is shown or sent:
 * editable fields (the search text, a new product's name or EAN) never
 * keep a product id attached (issue #17).
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

/**
 * Switching between "existing" and "new product" starts that part of the
 * line over, so nothing picked or typed for one mode leaks into the other.
 */
function setNewProduct(isNew: boolean) {
    formData.isNewProduct = isNew;
    picked.value = null;
    formData.EAN = '';
    formData.name = '';
    formData.price = '';
    formData.autoGenerateEAN = false;
    clearError('EAN', 'name', 'price');
    resetMatches();
}

watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        const item = props.item;
        const isNew = item?.isNewProduct ?? false;
        formData.isNewProduct = isNew;
        formData.autoGenerateEAN = isNew
            ? (item?.autoGenerateEAN ?? false)
            : false;
        formData.EAN = item?.EAN ?? '';
        formData.quantity = item?.quantity ?? '';
        formData.unitCost =
            item?.unitCost != null ? centavosToPesoInput(item.unitCost) : '';
        formData.product = '';
        formData.name = isNew ? (item?.name ?? '') : '';
        formData.price =
            isNew && item?.price ? centavosToPesoInput(item.price) : '';
        picked.value =
            !isNew && item?.product
                ? {
                      product: item.product,
                      name: item.name,
                      EAN: item.EAN,
                  }
                : null;
        errors.value = {};
        resetMatches();
    },
);

const handleSubmit = async () => {
    errors.value = restockLineErrors({
        ...formData,
        product: formData.isNewProduct ? '' : (picked.value?.product ?? ''),
    });
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

    const amounts = {
        quantity: Number(formData.quantity),
        unitCost: pesosToCentavos(formData.unitCost),
    };
    // A new product never carries a product id; an existing one never
    // carries new-product fields, and shows exactly what was picked.
    const payload: AddForm =
        formData.isNewProduct || !picked.value
            ? {
                  isNewProduct: true,
                  autoGenerateEAN: formData.autoGenerateEAN,
                  EAN: formData.EAN,
                  name: formData.name,
                  price: pesosToCentavos(formData.price),
                  ...amounts,
              }
            : {
                  isNewProduct: false,
                  autoGenerateEAN: false,
                  EAN: picked.value.EAN,
                  name: picked.value.name,
                  product: picked.value.product,
                  ...amounts,
              };
    if (isEditMode.value) emit('update', payload);
    else emit('add', payload);
    model.value = false;
};
</script>
