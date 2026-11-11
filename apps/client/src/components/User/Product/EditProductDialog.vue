<template>
    <BaseModal
        v-model="open"
        title="Edit Product"
        scrollable
        max-width="28rem"
        :closable="!saving"
    >
        <div class="space-y-4">
            <BaseInput
                v-model="name"
                label="Product name"
                :maxlength="STRING_LIMITS.PRODUCT_NAME"
            />
            <ProductCostSummary
                v-if="admin"
                :product="product._id"
                :unit="product.unit"
            />
            <label class="flex items-center gap-2 text-sm"
                ><input v-model="tracksExpiry" type="checkbox" />Track expiry
                and batches (change only at zero stock)</label
            >
            <CategorySelect
                v-model="category"
                :current="product.category"
                :refresh-key="open"
            />
            <p class="text-sm">
                Unit: {{ unitLabel(product.unit) }} (cannot be changed)
            </p>
            <BaseInput
                v-if="admin"
                v-model="price"
                label="Selling price (₱)"
                inputmode="decimal"
            />
            <BaseInput
                v-model="reorderLevel"
                :label="`Reorder level (${unitLabel(product.unit)})`"
                :help="INVENTORY_HELP.reorderLevel"
                help-label="About reorder level"
                inputmode="decimal"
            />
            <BaseInput
                v-model="reorderQuantity"
                :label="`Restock quantity (${unitLabel(product.unit)})`"
                :help="INVENTORY_HELP.reorderQuantity"
                help-label="About restock quantity"
                inputmode="decimal"
            />
            <p v-if="error" role="alert" class="text-sm text-red-700">
                {{ error }}
            </p>
        </div>
        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="saving"
                @click="open = false"
                >Cancel</BaseButton
            >
            <BaseButton :disabled="saving" @click="save">{{
                saving ? 'Saving…' : 'Save'
            }}</BaseButton>
        </template>
    </BaseModal>
</template>
<script setup lang="ts">
import ProductCostSummary from './ProductCostSummary.vue';
import { ref, watch } from 'vue';
import {
    Role,
    STRING_LIMITS,
    NUMERIC_LIMITS,
    unitLabel,
    quantityInput,
    parseQuantity,
    reorderLevelOf,
    reorderQuantityOf,
    type ProductView,
    type ProductUpdateRequest,
    type UpdateProductsRequest,
} from '@grocery-pos/contracts';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import CategorySelect from './CategorySelect.vue';
import { INVENTORY_HELP } from '@/components/User/Inventory/inventory-help';
import BaseButton from '@/components/ui/BaseButton.vue';
import api from '@/axios';
import { useAuthStore } from '@/stores/auth';
import { parsePesos } from '@/utils/currency';
import { apiErrorText } from '@/utils/api-error';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ product: ProductView }>();
const emit = defineEmits<{ saved: [] }>();
const admin = useAuthStore().user?.roles.includes(Role.Admin) ?? false;
const name = ref('');
const category = ref<string | undefined>();
const tracksExpiry = ref(false);
const price = ref('');
const reorderLevel = ref('');
const reorderQuantity = ref('');
const error = ref('');
const saving = ref(false);
watch(
    () => [open.value, props.product] as const,
    () => {
        if (open.value) {
            tracksExpiry.value = props.product.tracksExpiry ?? false;
            name.value = props.product.name;
            category.value = props.product.category;
            price.value = (props.product.price / 100).toFixed(2);
            reorderLevel.value = quantityInput(
                reorderLevelOf(props.product),
                props.product.unit,
            );
            reorderQuantity.value = quantityInput(
                reorderQuantityOf(props.product),
                props.product.unit,
            );
            error.value = '';
        }
    },
    { immediate: true },
);
async function save() {
    if (saving.value) return;
    const normalized = name.value.trim().toLowerCase();
    const amount = parsePesos(price.value);
    if (!normalized || normalized.length > STRING_LIMITS.PRODUCT_NAME) {
        error.value = 'Enter a valid product name.';
        return;
    }
    if (
        admin &&
        (amount === null ||
            amount < NUMERIC_LIMITS.PRICE_MIN ||
            amount > NUMERIC_LIMITS.AMOUNT_MAX)
    ) {
        error.value = 'Enter a valid selling price.';
        return;
    }
    const level = parseQuantity(reorderLevel.value, props.product.unit);
    const quantity = parseQuantity(reorderQuantity.value, props.product.unit);
    if (level === null || level < 0 || quantity === null || quantity < 1) {
        error.value =
            'Enter a valid reorder level and positive restock quantity.';
        return;
    }
    const update = {
        ...(tracksExpiry.value !== (props.product.tracksExpiry ?? false) && {
            tracksExpiry: tracksExpiry.value,
        }),
        ...(level !== reorderLevelOf(props.product) && { reorderLevel: level }),
        ...(quantity !== reorderQuantityOf(props.product) && {
            reorderQuantity: quantity,
        }),
        name: normalized,
        ...(category.value !== props.product.category && {
            category: category.value ?? null,
        }),
        ...(admin &&
            amount !== null &&
            amount !== props.product.price && { price: amount }),
    } satisfies ProductUpdateRequest;
    saving.value = true;
    error.value = '';
    try {
        await api.patch('/products', {
            updates: [{ product: props.product._id, update }],
        } satisfies UpdateProductsRequest);
        emit('saved');
        open.value = false;
    } catch (cause) {
        error.value = apiErrorText(cause);
    } finally {
        saving.value = false;
    }
}
</script>
