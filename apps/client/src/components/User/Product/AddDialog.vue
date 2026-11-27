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
                @enter="checkRepeats('EAN')"
                @blur="checkRepeats('EAN')"
            />
            <BaseButton
                v-if="repeatOf.EAN"
                variant="outline"
                size="sm"
                class="min-h-11"
                data-testid="edit-repeat-ean"
                @click="openRepeat(repeatOf.EAN)"
                >Edit that draft</BaseButton
            >
            <BaseCheckbox
                v-model="formData.autoGenerateEAN"
                label="Auto-generate EAN"
            />
            <BaseInput
                v-model="formData.name"
                label="Product Name"
                :maxlength="STRING_LIMITS.PRODUCT_NAME"
                :error="errors.name"
                @blur="onNameBlur"
            />
            <BaseButton
                v-if="repeatOf.name"
                variant="outline"
                size="sm"
                class="min-h-11"
                data-testid="edit-repeat-name"
                @click="openRepeat(repeatOf.name)"
                >Edit that draft</BaseButton
            >
            <BaseCheckbox
                v-model="formData.tracksExpiry"
                label="Track expiry and batches (online sales only)"
            />
            <CategorySelect v-model="formData.category" :refresh-key="model" />
            <label class="block text-sm font-medium"
                >Unit of measure
                <select
                    v-model="formData.unit"
                    class="w-full min-h-11 rounded-xl border border-slate-300 px-3"
                >
                    <option
                        v-for="unit in Object.values(UnitOfMeasure)"
                        :key="unit"
                        :value="unit"
                    >
                        {{ unit }}
                    </option>
                </select>
            </label>
            <BaseInput
                v-model="formData.price"
                :label="`Selling Price (₱/${unitLabel(formData.unit)})`"
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
            <BaseButton @click="submitProduct">
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
import CategorySelect from '@/components/User/Product/CategorySelect.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { Color, useUIStore } from '@/stores/ui';
import {
    normalizeProductName,
    STRING_LIMITS,
    UnitOfMeasure,
    unitLabel,
} from '@grocery-pos/contracts';
import { centavosToPesoInput, pesosToCentavos } from '@/utils/currency';
import { productNameCharactersError } from '@/utils/rules';
import { productErrors, type ProductFormInput } from './validation';
import {
    apiErrorMessages,
    DRAFT_EAN_REPEATED,
    DRAFT_NAME_REPEATED,
    PRODUCT_EAN_TAKEN,
    PRODUCT_NAME_TAKEN,
    productDuplicate,
} from '@/utils/api-error';
import { toEnsureValidQuery, type ProductDraft } from '@/utils/payloads';
import type { WithDraftId } from '@/composables/useDrafts';

const props = defineProps<{
    modelValue: boolean;
    item?: {
        tracksExpiry?: boolean;
        category?: string;
        unit?: UnitOfMeasure;
        EAN?: string;
        autoGenerateEAN?: boolean;
        /** Centavos. */
        price?: number;
        name?: string;
    };
    /** The page's other drafts, checked for a repeat (#478). */
    drafts?: WithDraftId<ProductDraft>[];
    /** The draft being edited, never flagged as its own repeat. */
    editingId?: string | null;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'add', payload: ProductDraft): void;
    (e: 'update', payload: ProductDraft): void;
    /**
     * Opens another draft instead (#478); `dirty` says this dialog's
     * entries would be discarded.
     */
    (e: 'edit-draft', draftId: string, dirty: boolean): void;
}>();

const model = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const uiStore = useUIStore();
const formData = reactive<ProductFormInput>({
    unit: UnitOfMeasure.PIECE,
    EAN: '',
    name: '',
    // Typed pesos; converted to centavos on submit.
    price: '',
    autoGenerateEAN: false,
});

const errors = ref<Record<string, string>>({});

const isEditMode = computed(() => !!props.item?.name);

/** The draft each field repeats (#478), with its inline error. */
const repeatOf = ref<{ name?: string; EAN?: string }>({});
let opened = '';
const snapshot = () => JSON.stringify(formData);

const findRepeat = (field: 'name' | 'EAN'): string | undefined => {
    if (field === 'EAN') {
        const ean = formData.EAN.trim();
        if (formData.autoGenerateEAN || !ean) return undefined;
        return props.drafts?.find(
            (d) =>
                d.draftId !== props.editingId &&
                !d.autoGenerateEAN &&
                d.EAN === ean,
        )?.draftId;
    }
    const name = normalizeProductName(formData.name);
    if (!name) return undefined;
    return props.drafts?.find(
        (d) =>
            d.draftId !== props.editingId &&
            normalizeProductName(d.name ?? '') === name,
    )?.draftId;
};

const REPEAT_TEXT = { name: DRAFT_NAME_REPEATED, EAN: DRAFT_EAN_REPEATED };

/** Flags (or unflags) a field repeating another draft; true if flagged. */
const checkRepeats = (field: 'name' | 'EAN'): boolean => {
    const id = findRepeat(field);
    const nextRepeat = { ...repeatOf.value };
    const nextErrors = { ...errors.value };
    if (id) {
        nextRepeat[field] = id;
        nextErrors[field] = REPEAT_TEXT[field];
    } else {
        delete nextRepeat[field];
        if (nextErrors[field] === REPEAT_TEXT[field]) delete nextErrors[field];
    }
    repeatOf.value = nextRepeat;
    errors.value = nextErrors;
    return !!id;
};

/** Leaving the name field checks its characters (#507), then repeats. */
const onNameBlur = () => {
    // Escape or × blurs the field as the dialog closes: no flash.
    if (!props.modelValue) return;
    const message = productNameCharactersError(formData.name);
    if (message) errors.value = { ...errors.value, name: message };
    else checkRepeats('name');
};

const openRepeat = (draftId: string) => {
    emit('edit-draft', draftId, snapshot() !== opened);
};

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            formData.tracksExpiry = props.item?.tracksExpiry ?? false;
            formData.category = props.item?.category;
            formData.unit = props.item?.unit ?? UnitOfMeasure.PIECE;
            formData.EAN = props.item?.EAN ?? '';
            formData.name = props.item?.name ?? '';
            formData.price =
                props.item?.price != null
                    ? centavosToPesoInput(props.item.price)
                    : '';
            formData.autoGenerateEAN = props.item?.autoGenerateEAN ?? false;
            errors.value = {};
            repeatOf.value = {};
            opened = snapshot();
        }
    },
);

// Auto-generate drops the barcode from the comparison.
watch(
    () => formData.autoGenerateEAN,
    () => {
        if (repeatOf.value.EAN) checkRepeats('EAN');
    },
);

// A field's error clears once it is edited (a taken name or barcode too,
// #455, #470).
for (const field of ['name', 'EAN'] as const) {
    watch(
        () => formData[field],
        () => {
            if (repeatOf.value[field]) {
                const rest = { ...repeatOf.value };
                delete rest[field];
                repeatOf.value = rest;
            }
            if (errors.value[field]) {
                const rest = { ...errors.value };
                delete rest[field];
                errors.value = rest;
            }
        },
    );
}

const submitProduct = async () => {
    errors.value = productErrors(formData);
    repeatOf.value = {};
    // A repeat of another draft is refused here (#478); Save All's server
    // check still catches a product saved meanwhile.
    for (const field of ['EAN', 'name'] as const)
        if (!errors.value[field]) checkRepeats(field);
    if (Object.keys(errors.value).length) return;

    try {
        await api.get('products/ensureValid', {
            params: toEnsureValidQuery(formData),
        });
    } catch (err) {
        // A taken name or barcode is inline under its field (#455, #470);
        // anything else stays a toast.
        const duplicate = productDuplicate(err);
        if (duplicate && (duplicate.nameTaken || duplicate.eanTaken)) {
            errors.value = {
                ...errors.value,
                ...(duplicate.nameTaken && { name: PRODUCT_NAME_TAKEN }),
                ...(duplicate.eanTaken && { EAN: PRODUCT_EAN_TAKEN }),
            };
            if (duplicate.others.length > 0)
                uiStore.queueMessage(Color.ERROR, duplicate.others);
            return;
        }
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(err, 'Could not check the product'),
        );
        return;
    }

    const { tracksExpiry, ...fields } = formData;
    const payload = {
        ...fields,
        // Shown in the draft list as it will be stored (#443).
        name: normalizeProductName(fields.name),
        ...(tracksExpiry && { tracksExpiry }),
        price: pesosToCentavos(formData.price),
    };
    if (isEditMode.value) {
        emit('update', payload);
    } else {
        emit('add', payload);
    }
    model.value = false;
};
</script>
