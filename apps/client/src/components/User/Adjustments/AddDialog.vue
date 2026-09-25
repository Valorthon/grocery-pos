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
                :options="comboboxOptions"
                label="Search Product (EAN or Name)"
                placeholder="Start typing..."
                :loading="isLoadingMatches"
                :error="errors.EAN"
                @search="debounceSearch"
                @select="handleProductSelect"
            />

            <BaseInput
                v-model.number="formData.change"
                label="Change"
                type="number"
                :error="errors.change"
            />

            <div>
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5"
                    >Reason</label
                >
                <textarea
                    v-model="formData.reason"
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
import api from '@/axios';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import type { ComboboxOption } from '@/components/ui/BaseCombobox.vue';
import { AddForm, MatchedProductsDto } from './dto';

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

const formData = reactive<AddForm>({
    EAN: '',
    name: '',
    change: 0,
    reason: '',
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
        formData.EAN = props.item?.EAN ?? '';
        formData.name = props.item?.name ?? '';
        formData.change = props.item?.change ?? 0;
        formData.reason = props.item?.reason ?? '';
        formData.product = props.item?.product ?? '';
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
    if (!formData.EAN) e.EAN = 'Select a product';
    if (formData.change == null || formData.change === 0)
        e.change = 'Change is required';
    // The API requires a reason on every line (AdjustFields).
    if (!formData.reason.trim()) e.reason = 'This field is required';
    errors.value = e;
    return Object.keys(e).length === 0;
}

function handleSubmit() {
    if (!validate()) return;
    const payload = { ...formData };
    if (isEditMode.value) emit('update', payload);
    else emit('add', payload);
    model.value = false;
}
</script>
