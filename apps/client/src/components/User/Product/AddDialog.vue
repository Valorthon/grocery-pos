<template>
    <v-card elevation="0" class="rounded-lg">
        <v-card-title
            class="d-flex align-center px-4 py-3 bg-amber-lighten-5 border-bottom"
        >
            <v-icon
                icon="mdi-package-variant-plus"
                color="amber-darken-2"
                class="me-2"
            />
            <span class="text-subtitle-1 font-weight-bold text-amber-darken-4">
                {{ isEditMode ? 'Edit Product Draft' : 'Add New Product' }}
            </span>
            <v-spacer />
            <v-btn
                icon="mdi-close"
                variant="text"
                density="comfortable"
                color="grey-darken-1"
                @click="$emit('close')"
            />
        </v-card-title>

        <v-divider />

        <v-card-text class="pa-5">
            <v-form
                ref="formRef"
                v-model="isFormValid"
                @submit.prevent="submitProduct"
            >
                <v-row>
                    <v-col cols="12" class="pb-0">
                        <v-text-field
                            v-model="formData.EAN"
                            label="EAN / Barcode"
                            prepend-inner-icon="mdi-barcode-scan"
                            variant="outlined"
                            density="comfortable"
                            color="amber-darken-2"
                            hide-details="auto"
                            :rules="eanRules"
                            :disabled="formData.autoGenerateEAN"
                            :placeholder="
                                formData.autoGenerateEAN
                                    ? 'System will generate EAN automatically'
                                    : 'Scan or type barcode'
                            "
                        />
                        <v-checkbox
                            v-model="formData.autoGenerateEAN"
                            label="Auto-generate EAN"
                            color="amber-darken-2"
                            density="compact"
                            hide-details="auto"
                            @update:model-value="handleAutoGenerateToggle"
                        />
                    </v-col>

                    <v-col cols="12">
                        <v-text-field
                            v-model="formData.name"
                            label="Product Name"
                            prepend-inner-icon="mdi-format-text"
                            variant="outlined"
                            density="comfortable"
                            hide-details="auto"
                            color="amber-darken-2"
                            :rules="[rules.required]"
                        />
                    </v-col>

                    <v-col cols="12" sm="6">
                        <v-text-field
                            v-model.number="formData.price"
                            label="Selling Price"
                            prepend-inner-icon="mdi-currency-php"
                            variant="outlined"
                            density="comfortable"
                            hide-details="auto"
                            color="amber-darken-2"
                            type="number"
                            min="0"
                            :rules="[rules.required, rules.minZero]"
                        />
                    </v-col>
                </v-row>
            </v-form>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-5 py-3 bg-grey-lighten-5">
            <v-spacer />
            <v-btn
                color="grey-darken-2"
                variant="text"
                class="text-none px-4"
                @click="$emit('close')"
            >
                Cancel
            </v-btn>
            <v-btn
                color="amber-darken-2"
                variant="flat"
                class="text-none px-6"
                :prepend-icon="isEditMode ? 'mdi-content-save' : 'mdi-plus'"
                :disabled="!isFormValid"
                @click="submitProduct"
            >
                {{ isEditMode ? 'Update Draft' : 'Add to Draft' }}
            </v-btn>
        </v-card-actions>
    </v-card>
</template>

<script setup lang="ts">
import api from '@/axios';
import { Color, useUIStore } from '@/stores/ui';
import { isAxiosError } from 'axios';
import type { VForm } from 'vuetify/components';
import { ref, reactive, computed, onMounted } from 'vue';

const emit = defineEmits(['close', 'add', 'update']);

const props = defineProps<{
    item: {
        EAN?: string;
        autoGenerateEAN?: boolean;
        price?: number;
        name?: string;
    };
}>();

const formRef = ref<VForm | null>(null);
const isFormValid = ref(false);
const uiStore = useUIStore();
const formData = reactive({
    EAN: '',
    name: '',
    price: null as number | null,
    autoGenerateEAN: false,
});

const isEditMode = computed(() => !!props.item?.name);

onMounted(() => {
    if (isEditMode.value) {
        formData.EAN = props.item.EAN || '';
        formData.name = props.item.name || '';
        formData.price = props.item.price || null;
        formData.autoGenerateEAN = props.item.autoGenerateEAN || false;
    }
});

const rules = {
    required: (v: unknown) => !!v || 'This field is required',
    minZero: (v: number) => v >= 0 || 'Cannot be a negative number',
};

const eanRules = computed(() => {
    return formData.autoGenerateEAN ? [] : [rules.required];
});

const handleAutoGenerateToggle = (isGenerating: boolean | null) => {
    if (isGenerating) {
        formData.EAN = '';
    }
};

const submitProduct = async () => {
    const { valid } = await formRef.value!.validate();

    if (valid) {
        try {
            await api.get('products/ensureValid', {
                params: {
                    ...formData,
                },
            });
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

        if (isEditMode.value) {
            // If editing, emit 'update' instead of 'add'
            emit('update', { ...formData });
        } else {
            // If adding new, emit 'add'
            emit('add', { ...formData });
        }
        formRef.value!.reset();
    }
};
</script>
