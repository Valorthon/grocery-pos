<template>
    <v-card elevation="2" class="rounded-lg border">
        <v-card-title class="d-flex align-center px-4 py-3 bg-grey-lighten-4">
            <v-icon icon="mdi-cart-plus" color="amber-darken-2" class="me-2" />
            <span class="text-subtitle-1 font-weight-bold">Point of Sale</span>
            <v-spacer />
            <div class="d-flex ga-2">
                <v-btn
                    color="green-darken-2"
                    variant="flat"
                    prepend-icon="mdi-cash-register"
                    size="small"
                    :disabled="cart.length === 0"
                    @click="isCheckoutOpen = true"
                >
                    Checkout
                </v-btn>
            </div>
        </v-card-title>

        <v-divider />

        <v-card-text class="bg-grey-lighten-5 pt-4">
            <v-row align="center">
                <v-col cols="12" md="6">
                    <v-text-field
                        v-model="searchEAN"
                        label="Scan Barcode / EAN"
                        prepend-inner-icon="mdi-barcode-scan"
                        variant="outlined"
                        density="compact"
                        bg-color="white"
                        hide-details
                        color="amber-darken-2"
                        clearable
                        @keydown.enter="lookupProduct"
                    />
                </v-col>
                <v-col cols="12" md="6">
                    <v-text-field
                        v-model="searchName"
                        label="Search Product Name"
                        prepend-inner-icon="mdi-magnify"
                        variant="outlined"
                        density="compact"
                        bg-color="white"
                        hide-details
                        color="amber-darken-2"
                        clearable
                        @update:model-value="fetchMatches"
                    />
                    <v-list
                        v-if="matches.length"
                        class="mt-1 bg-white"
                        elevation="2"
                        rounded="lg"
                    >
                        <v-list-item
                            v-for="match in matches"
                            :key="match.product"
                            :title="match.name"
                            :subtitle="match.EAN"
                            @click="addToCart(match)"
                        />
                    </v-list>
                </v-col>
            </v-row>
        </v-card-text>

        <v-divider />

        <v-data-table
            v-model:items-per-page="limit"
            :headers="headers"
            :items="cart"
            hover
        >
            <template #no-data>
                <div class="pa-4 text-grey-darken-1">
                    Cart is empty. Scan or search a product to add.
                </div>
            </template>

            <template #[`item.quantity`]="{ item }">
                <v-text-field
                    v-model.number="item.quantity"
                    type="number"
                    min="1"
                    density="compact"
                    variant="outlined"
                    hide-details
                    style="max-width: 100px"
                />
            </template>

            <template #[`item.unitPrice`]="{ item }">
                ₱{{ item.unitPrice.toLocaleString() }}
            </template>

            <template #[`item.total`]="{ item }">
                ₱{{ (item.unitPrice * item.quantity).toLocaleString() }}
            </template>

            <template #[`item.actions`]="{ item }">
                <v-btn
                    icon="mdi-delete"
                    variant="text"
                    color="red-darken-2"
                    size="small"
                    density="comfortable"
                    @click="removeFromCart(item)"
                />
            </template>
        </v-data-table>

        <v-divider />

        <v-card-text class="d-flex justify-end align-center ga-4 py-4">
            <span class="text-h6 font-weight-bold">Total:</span>
            <span class="text-h5 font-weight-bold text-primary">
                ₱{{ totalAmount.toLocaleString() }}
            </span>
        </v-card-text>
    </v-card>

    <!-- Checkout Dialog -->
    <v-dialog v-model="isCheckoutOpen" max-width="480" destroy-on-close>
        <v-card rounded="xl" elevation="0" border>
            <v-card-title class="pa-5 text-subtitle-1 font-weight-bold">
                Checkout
            </v-card-title>
            <v-divider />
            <v-card-text class="pa-5">
                <v-select
                    v-model="paymentType"
                    :items="paymentOptions"
                    label="Payment Type"
                    variant="outlined"
                    density="compact"
                    color="amber-darken-2"
                    class="mb-4"
                />
                <v-text-field
                    v-model="referenceNumber"
                    label="Reference Number (optional)"
                    variant="outlined"
                    density="compact"
                    color="amber-darken-2"
                    clearable
                />
                <div class="d-flex justify-space-between mt-4">
                    <span class="text-body-1 font-weight-bold">Total</span>
                    <span class="text-h6 font-weight-bold text-primary">
                        ₱{{ totalAmount.toLocaleString() }}
                    </span>
                </div>
            </v-card-text>
            <v-divider />
            <v-card-actions class="pa-5">
                <v-spacer />
                <v-btn variant="tonal" @click="isCheckoutOpen = false">
                    Cancel
                </v-btn>
                <v-btn
                    color="green-darken-2"
                    variant="flat"
                    :loading="saving"
                    @click="submitSale"
                >
                    Confirm Sale
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import api from '@/axios';
import { Color, useUIStore } from '@/stores/ui';
import { isAxiosError } from 'axios';
import { PaymentType } from '@grocery-pos/shared';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

interface CartItem {
    product: string;
    EAN: string;
    name: string;
    unitPrice: number;
    quantity: number;
}

const searchEAN = ref('');
const searchName = ref('');
const matches = ref<Array<{ product: string; EAN: string; name: string }>>([]);
const cart = ref<CartItem[]>([]);
const limit = ref(10);
const isCheckoutOpen = ref(false);
const paymentType = ref<PaymentType>(PaymentType.CASH);
const referenceNumber = ref('');
const saving = ref(false);
const uiStore = useUIStore();
const router = useRouter();

const paymentOptions = [
    { title: 'Cash', value: PaymentType.CASH },
    { title: 'GCash', value: PaymentType.GCASH },
];

const headers = ref([
    { title: 'EAN', key: 'EAN', align: 'start' as const, sortable: false },
    { title: 'Name', key: 'name', align: 'start' as const, sortable: false },
    {
        title: 'Unit Price',
        key: 'unitPrice',
        align: 'start' as const,
        sortable: false,
    },
    {
        title: 'Qty',
        key: 'quantity',
        align: 'start' as const,
        sortable: false,
    },
    { title: 'Total', key: 'total', align: 'start' as const, sortable: false },
    {
        title: 'Actions',
        key: 'actions',
        align: 'end' as const,
        sortable: false,
    },
]);

const totalAmount = computed(() =>
    cart.value.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
);

async function lookupProduct() {
    if (!searchEAN.value) return;
    try {
        const res = await api.get(`/products/${searchEAN.value}`);
        const product = res.data;
        addToCart({
            product: product._id,
            EAN: product.EAN,
            name: product.name,
        });
        searchEAN.value = '';
    } catch {
        uiStore.queueMessage(Color.ERROR, 'Product not found');
    }
}

async function fetchMatches() {
    if (!searchName.value) {
        matches.value = [];
        return;
    }
    try {
        const res = await api.get('/products/matches', {
            params: { name: searchName.value.toUpperCase() },
        });
        matches.value = res.data;
    } catch {
        matches.value = [];
    }
}

function addToCart(match: { product: string; EAN: string; name: string }) {
    const existing = cart.value.find((c) => c.product === match.product);
    if (existing) {
        existing.quantity++;
    } else {
        cart.value.push({
            product: match.product,
            EAN: match.EAN,
            name: match.name,
            unitPrice: 0,
            quantity: 1,
        });
        fetchPrices();
    }
    matches.value = [];
    searchName.value = '';
}

async function fetchPrices() {
    const ids = cart.value
        .filter((c) => c.unitPrice === 0)
        .map((c) => c.product);
    if (!ids.length) return;
    try {
        const res = await api.get('/products', {
            params: { page: 1, limit: 100 },
        });
        const products = res.data.data as Array<{
            _id: string;
            price: number;
        }>;
        cart.value.forEach((item) => {
            const p = products.find((prod) => prod._id === item.product);
            if (p) item.unitPrice = p.price;
        });
    } catch {
        // silent
    }
}

function removeFromCart(item: CartItem) {
    const idx = cart.value.indexOf(item);
    if (idx > -1) cart.value.splice(idx, 1);
}

async function submitSale() {
    if (cart.value.length === 0) return;
    saving.value = true;
    try {
        const sellDetails = cart.value.map((item) => ({
            product: item.product,
            quantity: item.quantity,
        }));

        await api.post('/sales', {
            paymentType: paymentType.value,
            referenceNumber: referenceNumber.value || undefined,
            sellDetails,
        });

        uiStore.queueMessage(Color.SUCCESS, 'Sale completed successfully');
        cart.value = [];
        isCheckoutOpen.value = false;
        router.push({ name: 'Sales' });
    } catch (error) {
        if (isAxiosError(error)) {
            uiStore.queueMessage(
                Color.ERROR,
                error.response?.data?.message ?? 'Sale failed',
            );
        }
    } finally {
        saving.value = false;
    }
}
</script>
