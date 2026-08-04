<template>
    <v-card elevation="0" class="rounded-lg">
        <v-card-title
            class="d-flex align-center px-4 py-3 bg-blue-grey-lighten-5 border-bottom"
        >
            <v-icon
                icon="mdi-package-down"
                color="blue-grey-darken-2"
                class="me-2"
            />
            <span
                class="text-subtitle-1 font-weight-bold text-blue-grey-darken-4"
            >
                {{ isEditMode ? 'Edit Restock Entry' : 'Add Restock Entry' }}
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
                @submit.prevent="handleSubmit"
            >
                <v-row>
                    <template v-if="formData.isNewProduct">
                        <v-col cols="12" class="py-0">
                            <v-text-field
                                v-model="formData.EAN"
                                label="EAN"
                                clearable
                                prepend-inner-icon="mdi-format-text"
                                variant="outlined"
                                density="comfortable"
                                color="blue-grey-darken-2"
                                :disabled="formData.autoGenerateEAN"
                                hide-details="auto"
                                :rules="EANRules"
                            />
                            <v-checkbox
                                v-model="formData.autoGenerateEAN"
                                label="Auto-generate EAN"
                                color="amber-darken-2"
                                density="compact"
                                hide-details="auto"
                                @update:model-value="formData.EAN = ''"
                            />
                        </v-col>
                    </template>
                    <template v-else>
                        <v-col cols="12" class="py-0">
                            <v-autocomplete
                                v-model="formData.EAN"
                                :items="matchedProducts"
                                item-title="name"
                                item-value="EAN"
                                :loading="isLoadingMatches"
                                :custom-filter="() => true"
                                :rules="[rules.required]"
                                label="Search Product (EAN or Name)"
                                placeholder="Start typing..."
                                clearable
                                @update:search="debounceSearch"
                                @update:model-value="handleProductSelect"
                            />
                        </v-col>
                    </template>
                    <v-col cols="12" sm="6" class="py-0">
                        <v-text-field
                            v-model.number="formData.quantity"
                            label="Quantity"
                            prepend-inner-icon="mdi-counter"
                            variant="outlined"
                            density="comfortable"
                            color="blue-grey-darken-2"
                            type="number"
                            min="1"
                            hide-details="auto"
                            :rules="[rules.required, rules.minOne]"
                        />
                    </v-col>

                    <v-col cols="12" sm="6" class="py-0">
                        <v-text-field
                            v-model.number="formData.unitCost"
                            label="Unit Cost"
                            prepend-inner-icon="mdi-currency-php"
                            variant="outlined"
                            density="comfortable"
                            color="blue-grey-darken-2"
                            type="number"
                            min="0"
                            hide-details="auto"
                            :rules="[rules.required, rules.minZero]"
                        />
                    </v-col>

                    <v-col cols="12" class="pt-0">
                        <v-checkbox
                            v-model="formData.isNewProduct"
                            label="This is a new product"
                            color="blue-grey-darken-2"
                            density="compact"
                            hide-details="auto"
                            @update:model-value="handleNewProductToggle"
                        />
                    </v-col>

                    <template v-if="formData.isNewProduct">
                        <v-col cols="12" class="pt-2">
                            <v-text-field
                                v-model="formData.name"
                                label="Product Name"
                                prepend-inner-icon="mdi-format-text"
                                variant="outlined"
                                density="comfortable"
                                color="blue-grey-darken-2"
                                :rules="[rules.required]"
                                hide-details="auto"
                            />
                        </v-col>

                        <v-col cols="12" sm="6" class="py-0">
                            <v-text-field
                                v-model.number="formData.price"
                                label="Selling Price"
                                prepend-inner-icon="mdi-tag-outline"
                                variant="outlined"
                                density="comfortable"
                                color="blue-grey-darken-2"
                                type="number"
                                min="0"
                                hide-details="auto"
                                :rules="[rules.required, rules.minZero]"
                            />
                        </v-col>
                    </template>
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
                color="blue-grey-darken-2"
                variant="flat"
                class="text-none px-6"
                :prepend-icon="isEditMode ? 'mdi-content-save' : 'mdi-plus'"
                :disabled="!isFormValid"
                @click="handleSubmit"
            >
                {{ isEditMode ? 'Update Restock' : 'Restock' }}
            </v-btn>
        </v-card-actions>
    </v-card>
</template>

<script setup lang="ts">
import api from '@/axios';
import { Color, useUIStore } from '@/stores/ui';
import type { VForm } from 'vuetify/components';
import { ref, reactive, computed, onMounted } from 'vue';
import { AddForm, MatchedProductsDto } from './dto';
import { isAxiosError } from 'axios';
import { rules } from '@/utils/rules';

const props = defineProps<{ item?: AddForm }>();

const emit = defineEmits<{
    close: [];
    add: [payload: AddForm];
    update: [payload: AddForm];
}>();

const formRef = ref<VForm | null>(null);
const isFormValid = ref(false);
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

const EANRules = computed(() => {
    return formData.autoGenerateEAN ? [] : [rules.required];
});

const isEditMode = computed(
    () => !!props.item && Object.keys(props.item).length > 0,
);

onMounted(() => {
    if (isEditMode.value && props.item) {
        formData.autoGenerateEAN = props.item.autoGenerateEAN || false;
        formData.EAN = props.item.EAN || '';
        formData.quantity = props.item.quantity || 0;
        formData.unitCost = props.item.unitCost || 0;
        formData.product = props.item.product || undefined;

        formData.isNewProduct = props.item.isNewProduct || false;
        formData.name = props.item.name || '';
        formData.price = props.item.price || undefined;
    }
});

const handleNewProductToggle = () => {
    if (!formData.isNewProduct) {
        formData.name = '';
        formData.price = 0;
    }
};

const uiStore = useUIStore();

const handleSubmit = async () => {
    const { valid } = await formRef.value!.validate();

    if (valid) {
        if (formData.isNewProduct) {
            try {
                await api.get('products/ensureValid', {
                    params: {
                        ...formData,
                    },
                });
            } catch (error) {
                if (isAxiosError(error)) {
                    let message = error.response?.data.message;
                    message = Array.isArray(message) ? message : [message];

                    message.forEach((msg: string) =>
                        uiStore.queueMessage(Color.ERROR, msg),
                    );
                }
                return;
            }
        }

        let payload = { ...formData };
        console.log({ payload });

        if (isEditMode.value) emit('update', payload);
        else emit('add', payload);

        formRef.value!.reset();
    }
};

const handleProductSelect = () => {
    console.log('Selection');
    const match = matchedProducts.value.find((x: MatchedProductsDto) => {
        return x.EAN === formData.EAN;
    });

    console.log({ match });
    if (match) {
        formData.name = match.name;
        formData.product = match.product;
    }
};

//Product Search
const matchedProducts = ref<MatchedProductsDto[]>([]);
const isLoadingMatches = ref(false);

let debounceId: ReturnType<typeof setTimeout>;

function debounceSearch(querySearch: string) {
    if (!querySearch) {
        matchedProducts.value = [];
        return;
    }
    if (debounceId) {
        clearTimeout(debounceId);
    }

    debounceId = setTimeout(() => {
        search(querySearch);
    }, 500);
}

async function search(querySearch: string) {
    if (!querySearch) return;

    isLoadingMatches.value = true;

    const query: Record<string, string> = {};
    const isNumeric = /^\d+$/.test(querySearch);

    if (isNumeric) query.EAN = querySearch;
    else query.name = querySearch.toUpperCase();

    const result = await api.get('products/matches', {
        params: query,
    });

    matchedProducts.value = result.data;
    isLoadingMatches.value = false;
}
</script>
