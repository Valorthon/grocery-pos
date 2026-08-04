<template>
    <v-card elevation="0" class="rounded-lg">
        <v-card-title
            class="d-flex align-center px-4 py-3 bg-amber-lighten-5 border-bottom"
        >
            <v-icon icon="mdi-tune" color="blue-grey-darken-2" class="me-2" />
            <span
                class="text-subtitle-1 font-weight-bold text-blue-grey-darken-4"
            >
                {{ isEditMode ? 'Edit Adjustment' : 'Adjust Stock' }}
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
                    <v-col cols="12" class="py-0">
                        <v-autocomplete
                            v-model="formData.EAN"
                            :items="matchedProducts"
                            item-title="name"
                            item-value="EAN"
                            :loading="isLoadingMatches"
                            :custom-filter="() => true"
                            :rules="[rules.required]"
                            hide-details="auto"
                            label="Search Product (EAN or Name)"
                            placeholder="Start typing..."
                            clearable
                            @update:search="debounceSearch"
                            @update:model-value="handleProductSelect"
                        />
                    </v-col>

                    <v-col cols="12" sm="6" class="py-0">
                        <v-text-field
                            v-model.number="formData.change"
                            label="Change"
                            prepend-inner-icon="mdi-counter"
                            variant="outlined"
                            density="comfortable"
                            color="blue-grey-darken-2"
                            type="number"
                            hide-details="auto"
                            :rules="[rules.required]"
                        />
                    </v-col>

                    <v-col cols="12" class="py-0">
                        <v-textarea
                            v-model.number="formData.reason"
                            label="Reason"
                            prepend-inner-icon="mdi-format-text"
                            variant="outlined"
                            density="comfortable"
                            color="blue-grey-darken-2"
                            hide-details="auto"
                            auto-grow
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
                color="blue-grey-darken-2"
                variant="flat"
                class="text-none px-6"
                :prepend-icon="isEditMode ? 'mdi-content-save' : 'mdi-plus'"
                :disabled="!isFormValid"
                @click="handleSubmit"
            >
                {{ isEditMode ? 'Update Adjustment' : 'Adjust' }}
            </v-btn>
        </v-card-actions>
    </v-card>
</template>

<script setup lang="ts">
import api from '@/axios';
import type { VForm } from 'vuetify/components';
import { ref, reactive, computed, onMounted } from 'vue';
import { AddForm, MatchedProductsDto } from './dto';
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
    EAN: '',
    name: '',
    change: 0,
    reason: '',
    product: '',
});

const isEditMode = computed(
    () => !!props.item && Object.keys(props.item).length > 0,
);

onMounted(() => {
    if (isEditMode.value && props.item) {
        formData.EAN = props.item.EAN || '';
        formData.name = props.item.name || '';
        formData.change = props.item.change || 0;
        formData.reason = props.item.reason || '';
        formData.product = props.item.product || '';
    }
});

const handleSubmit = async () => {
    const { valid } = await formRef.value!.validate();

    if (valid) {
        const payload = { ...formData };

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

// Product Search
const matchedProducts = ref<MatchedProductsDto[]>([]);
const isLoadingMatches = ref(false);

let debounceId: ReturnType<typeof setTimeout>;

function debounceSearch(querySearch: string) {
    if (!querySearch && !formData.EAN) return;

    if (debounceId) clearTimeout(debounceId);

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
