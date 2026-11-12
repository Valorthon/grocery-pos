<template>
    <BaseModal
        v-model="open"
        title="Edit Product"
        scrollable
        max-width="32rem"
        :closable="!saving"
    >
        <div
            class="-mt-1 mb-4 flex flex-wrap items-center gap-2"
            data-testid="product-header"
        >
            <span
                class="font-mono text-sm text-muted"
                data-testid="product-ean"
                >{{ product.EAN }}</span
            >
            <Badge
                data-testid="unit-badge"
                :title="`Unit ${unitLabel(product.unit)} cannot be changed`"
                >{{ unitLabel(product.unit)
                }}<span class="sr-only">, unit cannot be changed</span></Badge
            >
            <StatusBadge
                :status="product.isActive === false ? 'archived' : 'active'"
                :map="PRODUCT_STATUS"
                data-testid="product-status"
            />
        </div>
        <div class="space-y-5">
            <section aria-labelledby="edit-product-details" class="space-y-4">
                <h3 id="edit-product-details" :class="SECTION">Details</h3>
                <BaseInput
                    v-model="name"
                    label="Product name"
                    :maxlength="STRING_LIMITS.PRODUCT_NAME"
                    :error="errors.name"
                    @update:model-value="errors.name = ''"
                />
                <CategorySelect
                    v-model="category"
                    :current="product.category"
                    :refresh-key="open"
                />
            </section>
            <section
                v-if="admin"
                aria-labelledby="edit-product-pricing"
                class="space-y-4"
            >
                <h3 id="edit-product-pricing" :class="SECTION">Pricing</h3>
                <div
                    class="grid gap-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,2.6fr)]"
                    data-testid="pricing-row"
                >
                    <BaseInput
                        v-model="price"
                        label="Selling price (₱)"
                        inputmode="decimal"
                        :error="errors.price"
                        @update:model-value="errors.price = ''"
                    />
                    <ProductCostSummary
                        tiles
                        :product="product._id"
                        :unit="product.unit"
                        :price="typedPrice"
                    />
                </div>
            </section>
            <section aria-labelledby="edit-product-stock" class="space-y-4">
                <h3 id="edit-product-stock" :class="SECTION">Stock planning</h3>
                <div class="grid gap-3 sm:grid-cols-2 sm:items-start">
                    <BaseInput
                        v-model="reorderLevel"
                        :label="`Low stock at (${unitLabel(product.unit)})`"
                        :help="INVENTORY_HELP.reorderLevel"
                        help-label="About low stock at"
                        inputmode="decimal"
                        :error="errors.reorderLevel"
                        @update:model-value="errors.reorderLevel = ''"
                    />
                    <BaseInput
                        v-model="reorderQuantity"
                        :label="`Restock amount (${unitLabel(product.unit)})`"
                        :help="INVENTORY_HELP.reorderQuantity"
                        help-label="About restock amount"
                        inputmode="decimal"
                        :error="errors.reorderQuantity"
                        @update:model-value="errors.reorderQuantity = ''"
                    />
                </div>
                <div class="flex items-center gap-1">
                    <label class="flex min-h-11 items-center gap-2 text-sm"
                        ><input
                            v-model="tracksExpiry"
                            type="checkbox"
                            :disabled="expiryLocked"
                            :aria-describedby="expiryHintId"
                        />Track expiry and batches</label
                    >
                    <InfoTooltip
                        class="-my-3 -ml-3.5"
                        label="About expiry tracking"
                        data-testid="expiry-help"
                        >{{ EXPIRY_HELP }}</InfoTooltip
                    >
                    <span :id="expiryHintId" class="sr-only">{{
                        EXPIRY_HELP
                    }}</span>
                </div>
            </section>
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
import { computed, reactive, ref, useId, watch } from 'vue';
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
    type StockIntegrityView,
    type UpdateProductsRequest,
} from '@grocery-pos/contracts';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import Badge from '@/components/ui/Badge.vue';
import InfoTooltip from '@/components/ui/InfoTooltip.vue';
import StatusBadge from '@/components/ui/StatusBadge.vue';
import CategorySelect from './CategorySelect.vue';
import { INVENTORY_HELP } from '@/components/User/Inventory/inventory-help';
import { PRODUCT_STATUS } from '@/views/User/list-help';
import BaseButton from '@/components/ui/BaseButton.vue';
import api from '@/axios';
import { useAuthStore } from '@/stores/auth';
import { Color, useUIStore } from '@/stores/ui';
import { parsePesos } from '@/utils/currency';
import { apiErrorText, isDuplicateName } from '@/utils/api-error';
const SECTION = 'text-xs font-bold uppercase tracking-wider text-muted';
const EXPIRY_HELP =
    'Expiry tracking can be turned on or off only while this product has zero stock and no batch history, so existing stock never gains or loses expiry dates. Sell, adjust or count it down to zero first.';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ product: ProductView }>();
const emit = defineEmits<{ saved: [] }>();
const admin = useAuthStore().user?.roles.includes(Role.Admin) ?? false;
const ui = useUIStore();
const expiryHintId = useId();
const name = ref('');
const category = ref<string | undefined>();
const tracksExpiry = ref(false);
const price = ref('');
const reorderLevel = ref('');
const reorderQuantity = ref('');
const errors = reactive({
    name: '',
    price: '',
    reorderLevel: '',
    reorderQuantity: '',
});
const saving = ref(false);
/** The typed price in centavos, or null when the save would refuse it. */
const typedPrice = computed(() => {
    const amount = parsePesos(price.value);
    return amount === null ||
        amount < NUMERIC_LIMITS.PRICE_MIN ||
        amount > NUMERIC_LIMITS.AMOUNT_MAX
        ? null
        : amount;
});
/*
 * Current stock, from the ledger integrity check every product role can
 * read; null while unknown. Tracking can change only at zero stock, so a
 * known nonzero stock disables the box. Batch history isn't readable
 * here (the batch list skips depleted lots), so the server stays the
 * final check for it (#282).
 */
const stock = ref<number | null>(null);
let stockTurn = 0;
const expiryLocked = computed(() => stock.value !== null && stock.value !== 0);
async function loadStock() {
    const turn = ++stockTurn;
    stock.value = null;
    try {
        const { data } = await api.get<StockIntegrityView>(
            `/products/${props.product._id}/movements/integrity`,
        );
        if (turn === stockTurn && typeof data?.stock === 'number')
            stock.value = data.stock;
    } catch {
        // Unknown: the box stays enabled and the server decides.
    }
}
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
            errors.name = '';
            errors.price = '';
            errors.reorderLevel = '';
            errors.reorderQuantity = '';
            void loadStock();
        }
    },
    { immediate: true },
);
async function save() {
    if (saving.value) return;
    const normalized = name.value.trim().toLowerCase();
    const amount = typedPrice.value;
    const level = parseQuantity(reorderLevel.value, props.product.unit);
    const quantity = parseQuantity(reorderQuantity.value, props.product.unit);
    errors.name =
        !normalized || normalized.length > STRING_LIMITS.PRODUCT_NAME
            ? 'Enter a valid product name.'
            : '';
    errors.price =
        admin && amount === null ? 'Enter a valid selling price.' : '';
    errors.reorderLevel =
        level === null || level < 0 ? 'Enter a valid low stock level.' : '';
    errors.reorderQuantity =
        quantity === null || quantity < 1
            ? 'Enter a positive restock amount.'
            : '';
    if (
        errors.name ||
        errors.price ||
        errors.reorderLevel ||
        errors.reorderQuantity ||
        level === null ||
        quantity === null
    )
        return;
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
    try {
        await api.patch('/products', {
            updates: [{ product: props.product._id, update }],
        } satisfies UpdateProductsRequest);
        emit('saved');
        open.value = false;
    } catch (cause) {
        // A taken name is inline; other failures are toasts (#17, #18).
        if (isDuplicateName(cause))
            errors.name = 'A product with this name already exists';
        else ui.queueMessage(Color.ERROR, apiErrorText(cause));
    } finally {
        saving.value = false;
    }
}
</script>
