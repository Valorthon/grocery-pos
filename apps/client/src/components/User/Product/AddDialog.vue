<template>
    <BaseModal
        v-model="model"
        :title="isEditMode ? 'Edit Product Draft' : 'Add New Product'"
        subtitle="Enter product details and pricing"
        max-width="28rem"
        scrollable
    >
        <div class="space-y-4">
            <BaseInput
                v-model="formData.EAN"
                label="EAN / Barcode"
                inputmode="numeric"
                autocomplete="off"
                :maxlength="STRING_LIMITS.EAN"
                :disabled="formData.autoGenerateEAN"
                :placeholder="
                    formData.autoGenerateEAN
                        ? 'System will generate EAN automatically'
                        : 'Scan or type barcode'
                "
                :error="errors.EAN"
            />
            <BaseCheckbox
                v-model="formData.autoGenerateEAN"
                label="Auto-generate EAN"
            />
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
        </div>

        <template #footer>
            <BaseButton variant="outline" @click="model = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" @click="submitProduct">
                <Save v-if="isEditMode" class="w-4 h-4" />
                <Plus v-else class="w-4 h-4" />
                {{ isEditMode ? 'Update Draft' : 'Add to Draft' }}
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
import { Color, useUIStore } from '@/stores/ui';
import { STRING_LIMITS } from '@grocery-pos/contracts';
import { centavosToPesoInput, pesosToCentavos } from '@/utils/currency';
import { productErrors, type ProductFormInput } from './validation';
import { apiErrorMessages } from '@/utils/api-error';
import { toEnsureValidQuery, type ProductDraft } from '@/utils/payloads';

const props = defineProps<{
    modelValue: boolean;
    item?: {
        EAN?: string;
        autoGenerateEAN?: boolean;
        /** Centavos. */
        price?: number;
        name?: string;
    };
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'add', payload: ProductDraft): void;
    (e: 'update', payload: ProductDraft): void;
}>();

const model = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const uiStore = useUIStore();
const formData = reactive<ProductFormInput>({
    EAN: '',
    name: '',
    // Typed pesos; converted to centavos on submit.
    price: '',
    autoGenerateEAN: false,
});

const errors = ref<Record<string, string>>({});

const isEditMode = computed(() => !!props.item?.name);

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            formData.EAN = props.item?.EAN ?? '';
            formData.name = props.item?.name ?? '';
            formData.price =
                props.item?.price != null
                    ? centavosToPesoInput(props.item.price)
                    : '';
            formData.autoGenerateEAN = props.item?.autoGenerateEAN ?? false;
            errors.value = {};
        }
    },
);

const submitProduct = async () => {
    errors.value = productErrors(formData);
    if (Object.keys(errors.value).length) return;

    try {
        await api.get('products/ensureValid', {
            params: toEnsureValidQuery(formData),
        });
    } catch (err) {
        apiErrorMessages(err, 'Could not check the product').forEach((msg) =>
            uiStore.queueMessage(Color.ERROR, msg),
        );
        return;
    }

    const payload = { ...formData, price: pesosToCentavos(formData.price) };
    if (isEditMode.value) {
        emit('update', payload);
    } else {
        emit('add', payload);
    }
    model.value = false;
};
</script>
