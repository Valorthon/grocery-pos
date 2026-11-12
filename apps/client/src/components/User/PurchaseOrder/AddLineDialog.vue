<template>
    <BaseModal
        v-model="model"
        :title="existing ? 'Edit line' : 'Add product'"
        max-width="32rem"
        scrollable
    >
        <div class="space-y-4" data-testid="po-line-dialog">
            <BaseCombobox
                v-model="searchText"
                v-model:selected="selected"
                :options="matchOptions"
                label="Product (EAN or name)"
                placeholder="Start typing..."
                :maxlength="STRING_LIMITS.PRODUCT_NAME"
                :loading="matchesLoading"
                :error="errors.product || matchError"
                @search="onSearch"
            />
            <p
                v-if="existing"
                class="text-sm text-muted"
                data-testid="po-line-existing"
            >
                This product is on the order: Update changes its line.
            </p>
            <div class="grid grid-cols-2 gap-4">
                <BaseInput
                    v-model="quantity"
                    :label="`Ordered (${unitLabel(picked?.unit)})`"
                    :help="PURCHASE_ORDER_HELP.ordered"
                    help-label="About Ordered"
                    numeric
                    :inputmode="
                        quantityScale(picked?.unit) === 1000
                            ? 'decimal'
                            : 'numeric'
                    "
                    autocomplete="off"
                    :data-autofocus="picked ? '' : undefined"
                    :error="errors.quantity"
                    @update:model-value="clearError('quantity')"
                />
                <BaseInput
                    v-model="cost"
                    :label="`Expected cost (₱/${unitLabel(picked?.unit)})`"
                    :help="PURCHASE_ORDER_HELP.expectedCost"
                    help-label="About Expected cost"
                    numeric
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="0.00"
                    :error="errors.cost"
                    @update:model-value="onCostInput"
                />
            </div>
        </div>
        <template #footer>
            <BaseButton variant="outline" @click="model = false"
                >Cancel</BaseButton
            >
            <BaseButton @click="submit">
                <Save v-if="existing" class="w-4 h-4" />
                <Plus v-else class="w-4 h-4" />
                {{ existing ? 'Update' : 'Add' }}
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
/**
 * Adds a product to a DRAFT purchase order, or edits its line when the
 * product is already on the order (#284): products stay distinct (#123).
 * The expected cost prefills from the latest receipt without overwriting
 * a typed cost; ₱0 needs no confirmation on a draft.
 */
import {
    NUMERIC_LIMITS,
    STRING_LIMITS,
    quantityScale,
    UnitOfMeasure,
    unitLabel,
    unitOf,
    type ProductCostView,
    type ProductView,
} from '@grocery-pos/contracts';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Plus, Save } from '@lucide/vue';
import api from '@/axios';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import type { ComboboxOption } from '@/components/ui/types';
import { useProductMatches } from '@/composables/useProductMatches';
import { Color, useUIStore } from '@/stores/ui';
import { centavosToPesoInput } from '@/utils/currency';
import { apiErrorText } from '@/utils/api-error';
import { fieldErrors, moneyError, quantityError } from '@/utils/rules';
import {
    PURCHASE_ORDER_HELP,
    type PurchaseOrderDraftLine,
} from './purchase-order';

const props = defineProps<{
    modelValue: boolean;
    /** The draft's current lines, to find a product already on it. */
    lines: PurchaseOrderDraftLine[];
    /** A page-wide scan of a product not yet on the order. */
    scanned?: ProductView | null;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'save', line: PurchaseOrderDraftLine): void;
}>();
const model = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value),
});

type Picked = Omit<PurchaseOrderDraftLine, 'quantity' | 'cost'>;
const ui = useUIStore();
const picked = ref<Picked | null>(null);
const searchText = ref('');
const quantity = ref('');
const cost = ref('');
/** Set once the user types a cost: the prefill never replaces it. */
const costTouched = ref(false);
let lastUnit: PurchaseOrderDraftLine['unit'];
const errors = ref<Record<string, string>>({});
const existing = computed(() =>
    picked.value
        ? props.lines.find((line) => line.product === picked.value!.product)
        : undefined,
);

const {
    matches,
    options: matchOptions,
    loading: matchesLoading,
    error: matchError,
    debouncedSearch,
    reset: resetMatches,
} = useProductMatches();

let costGeneration = 0;
onBeforeUnmount(() => {
    costGeneration++;
});

/** Takes `next` as the picked product (a snapshot, #17). */
function pick(next: Picked | null) {
    const generation = ++costGeneration;
    const wasExisting = !!existing.value;
    // Typing clears the pick first, so compare with the last picked unit.
    const previousUnit = lastUnit;
    if (next) lastUnit = next.unit;
    picked.value = next;
    clearError('product');
    const line = existing.value;
    if (line) {
        quantity.value = line.quantity;
        cost.value = line.cost;
        costTouched.value = true;
        return;
    }
    if (wasExisting) {
        quantity.value = '';
        cost.value = '';
        costTouched.value = false;
    } else if (previousUnit && next && previousUnit !== next.unit)
        quantity.value = '';
    if (next) loadCostDefault(next.product, generation);
}

const selected = computed<ComboboxOption | null>({
    get: () =>
        picked.value
            ? {
                  value: picked.value.product,
                  label: picked.value.name,
                  subtitle: `EAN: ${picked.value.EAN}`,
              }
            : null,
    set: (option) => {
        const match = option
            ? matches.value.find((m) => m.product === option.value)
            : undefined;
        pick(
            option
                ? {
                      product: option.value,
                      name: match?.name ?? option.label,
                      EAN: match?.EAN ?? option.display ?? '',
                      unit: unitOf(match?.unit),
                      tracksExpiry: match?.tracksExpiry,
                  }
                : null,
        );
    },
});

/** Prefills the expected cost unless the user has typed one. */
function loadCostDefault(product: string, generation: number) {
    api.get<ProductCostView[]>('/suppliers/costs', {
        params: { products: product },
    })
        .then((response) => {
            if (
                generation !== costGeneration ||
                !props.modelValue ||
                picked.value?.product !== product ||
                costTouched.value
            )
                return;
            const last = response.data[0]?.lastCost;
            if (last !== undefined) cost.value = centavosToPesoInput(last);
        })
        .catch((cause: unknown) => {
            if (generation !== costGeneration || !props.modelValue) return;
            ui.queueMessage(
                Color.ERROR,
                apiErrorText(
                    cause,
                    'Cost default unavailable. Enter the expected cost.',
                ),
            );
        });
}

function clearError(field: string) {
    if (!errors.value[field]) return;
    const next = { ...errors.value };
    delete next[field];
    errors.value = next;
}
function onCostInput() {
    costTouched.value = true;
    clearError('cost');
}
function onSearch(query: string) {
    clearError('product');
    debouncedSearch(query);
}

watch(
    () => props.modelValue,
    (open) => {
        costGeneration++;
        if (!open) return;
        picked.value = null;
        searchText.value = '';
        quantity.value = '';
        cost.value = '';
        costTouched.value = false;
        lastUnit = undefined;
        errors.value = {};
        resetMatches();
        const product = props.scanned;
        if (product) {
            searchText.value = product.EAN;
            pick({
                product: product._id,
                name: product.name,
                EAN: product.EAN,
                unit: unitOf(product.unit),
                tracksExpiry: product.tracksExpiry,
            });
            // A scanned piece starts at 1, as the fast path did (#214).
            if (unitOf(product.unit) === UnitOfMeasure.PIECE)
                quantity.value = '1';
        }
    },
    { immediate: true },
);

function submit() {
    const unit = picked.value?.unit;
    errors.value = fieldErrors({
        product: picked.value ? '' : 'Choose a product.',
        quantity: quantityError(quantity.value, unit),
        cost: moneyError(cost.value, NUMERIC_LIMITS.UNIT_COST_MIN),
    });
    if (!picked.value || Object.keys(errors.value).length) return;
    emit('save', {
        ...picked.value,
        quantity: quantity.value.trim(),
        cost: cost.value.trim(),
    });
    model.value = false;
}
</script>
