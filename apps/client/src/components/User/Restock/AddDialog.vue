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
                    :options="comboboxOptions"
                    label="Search Product (EAN or Name)"
                    placeholder="Start typing..."
                    :loading="isLoadingMatches"
                    :error="errors.EAN"
                    @search="debounceSearch"
                    @select="handleProductSelect"
                />
            </template>

            <div class="grid grid-cols-2 gap-4">
                <BaseInput
                    v-model.number="formData.quantity"
                    label="Quantity"
                    type="number"
                    min="1"
                    :error="errors.quantity"
                />
                <BaseInput
                    v-model.number="formData.unitCost"
                    label="Unit Cost"
                    type="number"
                    min="0"
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
                    :error="errors.name"
                />
                <BaseInput
                    v-model.number="formData.price"
                    label="Selling Price"
                    type="number"
                    min="0"
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
import { AddForm, MatchedProductsDto } from './dto';
import { Color, useUIStore } from '@/stores/ui';
import { isAxiosError } from 'axios';

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
const formData = reactive<AddForm>({
    autoGenerateEAN: false,
    EAN: '',
    quantity: 0,
    unitCost: 0,
    isNewProduct: false,
    name: '',
    price: 0,
    product: '',
});

const errors = ref<Record<string, string>>({});
const isEditMode = computed(
    () => !!props.item && Object.keys(props.item).length > 0,
);

watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        formData.autoGenerateEAN = props.item?.autoGenerateEAN ?? false;
        formData.EAN = props.item?.EAN ?? '';
        formData.quantity = props.item?.quantity ?? 0;
        formData.unitCost = props.item?.unitCost ?? 0;
        formData.product = props.item?.product ?? '';
        formData.isNewProduct = props.item?.isNewProduct ?? false;
        formData.name = props.item?.name ?? '';
        formData.price = props.item?.price ?? 0;
        errors.value = {};
        matchedProducts.value = [];
    },
);

const matchedProducts = ref<MatchedProductsDto[]>([]);
const isLoadingMatches = ref(false);

const comboboxOptions = computed<ComboboxOption[]>(() =>
    matchedProducts.value.map((m) => ({
        value: m.EAN,
        label: m.name,
        subtitle: `EAN: ${m.EAN}`,
    })),
);

function handleProductSelect(opt: ComboboxOption) {
    const match = matchedProducts.value.find((m) => m.EAN === opt.value);
    if (match) {
        formData.name = match.name;
        formData.product = match.product;
    }
}

let debounceId: ReturnType<typeof setTimeout> | undefined;
function debounceSearch(query: string) {
    if (debounceId) clearTimeout(debounceId);
    if (!query) {
        matchedProducts.value = [];
        return;
    }
    debounceId = setTimeout(() => search(query), 500);
}

async function search(query: string) {
    if (!query) return;
    isLoadingMatches.value = true;
    const isNumeric = /^\d+$/.test(query);
    const params: Record<string, string> = isNumeric
        ? { EAN: query }
        : { name: query.toUpperCase() };
    const result = await api.get('products/matches', { params });
    matchedProducts.value = result.data;
    isLoadingMatches.value = false;
}

function validate(): boolean {
    const e: Record<string, string> = {};
    if (!formData.isNewProduct && !formData.EAN) e.EAN = 'Select a product';
    if (formData.isNewProduct && !formData.autoGenerateEAN && !formData.EAN)
        e.EAN = 'This field is required';
    if (!formData.quantity || formData.quantity < 1)
        e.quantity = 'Must be at least 1';
    if (formData.unitCost == null || formData.unitCost < 0)
        e.unitCost = 'Cannot be negative';
    if (formData.isNewProduct) {
        if (!formData.name) e.name = 'This field is required';
        if (formData.price == null || formData.price < 0)
            e.price = 'Cannot be negative';
    }
    errors.value = e;
    return Object.keys(e).length === 0;
}

const handleSubmit = async () => {
    if (!validate()) return;

    if (formData.isNewProduct) {
        try {
            await api.get('products/ensureValid', { params: { ...formData } });
        } catch (err) {
            if (isAxiosError(err)) {
                let message = err.response?.data.message;
                message = Array.isArray(message) ? message : [message];
                message.forEach((msg: string) =>
                    uiStore.queueMessage(Color.ERROR, msg),
                );
            }
            return;
        }
    }

    const payload = { ...formData };
    if (isEditMode.value) emit('update', payload);
    else emit('add', payload);
    model.value = false;
};
</script>
