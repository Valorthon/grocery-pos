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
                :error="errors.name"
            />
            <BaseInput
                v-model.number="formData.price"
                label="Selling Price (₱)"
                type="number"
                min="0"
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
import { isAxiosError } from 'axios';
import { NUMERIC_LIMITS } from '@grocery-pos/contracts';
import { centavosToPesos, pesosToCentavos } from '@/utils/currency';

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
    (e: 'add', payload: Record<string, unknown>): void;
    (e: 'update', payload: Record<string, unknown>): void;
}>();

const model = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const uiStore = useUIStore();
const formData = reactive({
    EAN: '',
    name: '',
    // Typed pesos; converted to centavos on submit.
    price: null as number | null,
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
                    ? centavosToPesos(props.item.price)
                    : null;
            formData.autoGenerateEAN = props.item?.autoGenerateEAN ?? false;
            errors.value = {};
        }
    },
);

function validate(): boolean {
    const e: Record<string, string> = {};
    if (!formData.autoGenerateEAN && !formData.EAN)
        e.EAN = 'This field is required';
    if (!formData.name) e.name = 'This field is required';
    if (
        formData.price == null ||
        pesosToCentavos(formData.price) < NUMERIC_LIMITS.PRICE_MIN
    )
        e.price = 'Valid price is required';
    errors.value = e;
    return Object.keys(e).length === 0;
}

const submitProduct = async () => {
    if (!validate()) return;

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

    const payload = { ...formData, price: pesosToCentavos(formData.price) };
    if (isEditMode.value) {
        emit('update', payload);
    } else {
        emit('add', payload);
    }
    model.value = false;
};
</script>
