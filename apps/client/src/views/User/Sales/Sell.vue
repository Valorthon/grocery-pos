<template>
    <div
        class="flex-1 flex flex-col lg:flex-row h-full overflow-hidden bg-slate-100 text-slate-900"
    >
        <!-- LEFT: scan input + live ticket -->
        <div class="flex-1 flex flex-col h-full overflow-hidden bg-white">
            <div class="p-4 sm:p-5 bg-white shrink-0 border-b border-slate-200">
                <div
                    class="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-slate-100"
                >
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span
                                v-if="shiftStore.activeShift"
                                class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold"
                            >
                                <span>Shift Active</span>
                            </span>
                            <span
                                v-else
                                class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-bold"
                            >
                                <AlertCircle
                                    class="w-3.5 h-3.5 text-amber-600"
                                />
                                <span>No Active Shift</span>
                            </span>
                        </div>
                        <h1
                            class="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1"
                        >
                            Checkout Register
                        </h1>
                    </div>

                    <div class="flex items-center gap-2">
                        <template v-if="shiftStore.activeShift">
                            <button
                                type="button"
                                class="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1.5 transition-colors"
                                title="Add change when drawer coins or small bills run low"
                                @click="shiftStore.drawerAction = 'cash_in'"
                            >
                                <ArrowDownLeft
                                    class="w-3.5 h-3.5 text-emerald-600"
                                />
                                <span>+ Cash In</span>
                            </button>

                            <button
                                type="button"
                                class="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-xs font-bold flex items-center gap-1.5 transition-colors"
                                title="Drop excess cash safely to the back office safe"
                                @click="shiftStore.drawerAction = 'cash_drop'"
                            >
                                <ArrowUpRight
                                    class="w-3.5 h-3.5 text-amber-600"
                                />
                                <span>- Cash Drop</span>
                            </button>

                            <button
                                type="button"
                                class="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-extrabold flex items-center gap-1.5 transition-colors shadow-2xs"
                                title="Count physical cash in drawer, generate Z-Read report"
                                @click="shiftStore.shiftOutOpen = true"
                            >
                                <Calculator class="w-3.5 h-3.5 text-rose-600" />
                                <span>End Shift</span>
                            </button>
                        </template>
                    </div>
                </div>

                <form
                    class="mt-3 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center"
                    @submit.prevent="onScanSubmit"
                >
                    <div
                        class="flex items-center bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 shrink-0"
                    >
                        <span
                            class="text-xs font-bold text-slate-500 uppercase tracking-wider mr-2"
                            >Qty:</span
                        >
                        <select
                            v-model.number="scanMultiplier"
                            class="bg-transparent text-slate-900 font-extrabold text-sm focus:outline-none cursor-pointer"
                        >
                            <option v-for="q in qtyOptions" :key="q" :value="q">
                                {{ q }}x
                            </option>
                        </select>
                    </div>

                    <div class="relative flex-1">
                        <div
                            class="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-slate-400"
                        >
                            <Barcode class="w-5 h-5 text-slate-600" />
                        </div>
                        <input
                            ref="scanInput"
                            v-model="searchQuery"
                            type="text"
                            placeholder="Scan barcode, enter EAN, or search item..."
                            class="w-full pl-11 pr-24 py-2.5 bg-slate-50 text-slate-900 placeholder-slate-400 text-sm font-mono font-bold rounded-xl border border-slate-300 focus:border-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none transition-all"
                            @input="onSearchChange"
                        />
                        <div
                            class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1"
                        >
                            <button
                                v-if="searchQuery"
                                type="button"
                                class="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                                @click="
                                    searchQuery = '';
                                    scanInput?.focus();
                                "
                            >
                                <X class="w-4 h-4" />
                            </button>
                            <button
                                type="submit"
                                class="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold uppercase rounded-lg shadow-2xs transition-colors active:scale-[0.98]"
                            >
                                Enter / Scan
                            </button>
                        </div>
                    </div>
                </form>

                <div
                    v-if="scanFeedback"
                    class="mt-2.5 p-2.5 rounded-xl flex items-center gap-2 text-xs sm:text-sm font-bold transition-opacity"
                    :class="
                        scanFeedback.type === 'success'
                            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                            : 'bg-red-50 border border-red-200 text-red-800'
                    "
                >
                    <CheckCircle2
                        v-if="scanFeedback.type === 'success'"
                        class="w-4 h-4 text-emerald-600 shrink-0"
                    />
                    <AlertCircle v-else class="w-4 h-4 text-red-600 shrink-0" />
                    <span>{{ scanFeedback.message }}</span>
                </div>
            </div>

            <!-- Live matches -->
            <div
                v-if="searchQuery.trim().length > 0"
                class="bg-slate-50 border-b border-slate-200 p-4 shadow-inner max-h-72 overflow-y-auto z-20"
            >
                <div class="flex items-center justify-between mb-2">
                    <div
                        class="flex items-center gap-1.5 text-slate-700 font-bold text-xs uppercase tracking-wider"
                    >
                        <Search class="w-3.5 h-3.5" />
                        <span>Matching Items ({{ matches.length }})</span>
                    </div>
                    <span class="text-[11px] text-slate-500"
                        >Click item or press Enter to add</span
                    >
                </div>

                <div
                    v-if="matches.length === 0"
                    class="py-4 text-center text-slate-500 text-xs font-semibold"
                >
                    No item matching "{{ searchQuery }}". Check barcode number
                    or search by name.
                </div>
                <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                        v-for="m in matches"
                        :key="m.product"
                        type="button"
                        class="p-3 bg-white border border-slate-200 rounded-xl hover:border-slate-800 hover:shadow-xs transition-all flex items-center justify-between text-left group"
                        @click="selectMatch(m)"
                    >
                        <div>
                            <h4
                                class="text-xs sm:text-sm font-bold text-slate-900 line-clamp-1"
                            >
                                {{ m.name }}
                            </h4>
                            <p
                                class="text-[11px] font-mono text-slate-500 mt-0.5"
                            >
                                EAN: {{ m.EAN }}
                            </p>
                        </div>
                        <span
                            class="text-xs font-bold text-slate-600 group-hover:text-slate-900 pl-3 shrink-0"
                        >
                            Add
                        </span>
                    </button>
                </div>
            </div>

            <!-- Ticket table -->
            <div
                class="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 flex flex-col justify-between"
            >
                <div
                    class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-full"
                >
                    <div
                        class="px-5 py-3.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between"
                    >
                        <div class="flex items-center gap-2">
                            <ShoppingBag class="w-4 h-4 text-slate-700" />
                            <h2
                                class="text-xs sm:text-sm font-extrabold text-slate-900 uppercase tracking-wide"
                            >
                                Active Register Ticket
                            </h2>
                        </div>
                        <div class="flex items-center gap-3">
                            <span
                                class="bg-slate-200/80 text-slate-800 text-xs font-bold px-2.5 py-0.5 rounded-full"
                            >
                                {{ cartStore.totalUnits }} Units
                            </span>
                            <button
                                v-if="cartStore.items.length"
                                type="button"
                                class="text-xs font-bold text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-0.5 rounded-md transition-colors"
                                @click="voidTicket"
                            >
                                Void Ticket
                            </button>
                        </div>
                    </div>

                    <div
                        v-if="cartStore.items.length === 0"
                        class="py-20 px-6 text-center text-slate-400 flex-1 flex flex-col items-center justify-center"
                    >
                        <div
                            class="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center mb-3"
                        >
                            <Barcode class="w-7 h-7" />
                        </div>
                        <h3 class="text-base font-bold text-slate-800">
                            Register Ready
                        </h3>
                        <p
                            class="text-xs sm:text-sm text-slate-500 max-w-sm mt-1 leading-relaxed"
                        >
                            Scan a barcode, enter a EAN code, or search an item
                            above to ring up products.
                        </p>
                    </div>

                    <div v-else class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead>
                                <tr
                                    class="border-b border-slate-200 bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider"
                                >
                                    <th class="py-2.5 px-4 w-10 text-center">
                                        #
                                    </th>
                                    <th class="py-2.5 px-4">
                                        Item Description
                                    </th>
                                    <th class="py-2.5 px-4 font-mono">EAN</th>
                                    <th class="py-2.5 px-4 text-right">
                                        Price
                                    </th>
                                    <th class="py-2.5 px-4 text-center">
                                        Quantity
                                    </th>
                                    <th class="py-2.5 px-4 text-right">
                                        Line Total
                                    </th>
                                    <th class="py-2.5 px-4 text-center w-14">
                                        Void
                                    </th>
                                </tr>
                            </thead>
                            <tbody
                                class="divide-y divide-slate-100 text-slate-800 text-xs sm:text-sm"
                            >
                                <tr
                                    v-for="(item, index) in cartStore.items"
                                    :key="item.product"
                                    class="hover:bg-slate-50/80 transition-colors"
                                >
                                    <td
                                        class="py-3 px-4 text-center font-bold text-slate-400"
                                    >
                                        {{ index + 1 }}
                                    </td>
                                    <td class="py-3 px-4">
                                        <div
                                            class="font-bold text-slate-900 text-sm"
                                        >
                                            {{ item.name }}
                                        </div>
                                    </td>
                                    <td
                                        class="py-3 px-4 font-mono text-xs text-slate-500"
                                    >
                                        {{ item.EAN }}
                                    </td>
                                    <td
                                        class="py-3 px-4 text-right font-medium text-slate-600"
                                    >
                                        {{ currency(item.unitPrice) }}
                                    </td>
                                    <td class="py-3 px-4 text-center">
                                        <div
                                            class="inline-flex items-center bg-white border border-slate-300 rounded-lg p-0.5 shadow-2xs"
                                        >
                                            <button
                                                type="button"
                                                class="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                                                @click="
                                                    cartStore.setQuantity(
                                                        item.product,
                                                        item.quantity - 1,
                                                    )
                                                "
                                            >
                                                <Minus class="w-3.5 h-3.5" />
                                            </button>
                                            <span
                                                class="w-8 text-center font-bold text-slate-900 text-xs"
                                                >{{ item.quantity }}</span
                                            >
                                            <button
                                                type="button"
                                                class="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                                                @click="
                                                    cartStore.setQuantity(
                                                        item.product,
                                                        item.quantity + 1,
                                                    )
                                                "
                                            >
                                                <Plus class="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                    <td
                                        class="py-3 px-4 text-right font-bold text-slate-900"
                                    >
                                        {{
                                            currency(
                                                item.unitPrice * item.quantity,
                                            )
                                        }}
                                    </td>
                                    <td class="py-3 px-4 text-center">
                                        <button
                                            type="button"
                                            class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            @click="
                                                cartStore.remove(item.product)
                                            "
                                        >
                                            <Trash2 class="w-3.5 h-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- RIGHT: tender panel -->
        <div
            class="w-full lg:w-[400px] bg-white border-l border-slate-200 flex flex-col justify-between shrink-0 shadow-xs z-30"
        >
            <div class="p-6 space-y-4">
                <div
                    class="flex items-center justify-between text-xs sm:text-sm"
                >
                    <button
                        type="button"
                        class="text-slate-600 font-bold hover:text-slate-900 flex items-center gap-1.5 underline-offset-2 hover:underline"
                        @click="showDiscount = !showDiscount"
                    >
                        <Percent class="w-3.5 h-3.5 text-slate-500" />
                        {{
                            discountPercent > 0
                                ? `Discount Applied (${discountPercent}%)`
                                : '+ Apply Order Discount'
                        }}
                    </button>
                    <span
                        v-if="discountPercent > 0"
                        class="text-emerald-600 font-extrabold text-sm"
                    >
                        -{{ currency(discountAmount) }}
                    </span>
                </div>

                <div
                    v-if="showDiscount"
                    class="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-200"
                >
                    <span class="text-xs font-bold text-slate-500"
                        >Discount:</span
                    >
                    <button
                        v-for="d in discountOptions"
                        :key="d"
                        type="button"
                        class="px-2.5 py-1 rounded-lg text-xs font-bold transition-colors active:scale-[0.98]"
                        :class="
                            discountPercent === d
                                ? 'bg-slate-900 text-white'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        "
                        @click="applyDiscount(d)"
                    >
                        {{ d === 0 ? 'None' : `${d}%` }}
                    </button>
                </div>

                <div class="space-y-2.5 text-slate-600 text-xs sm:text-sm pt-1">
                    <div class="flex justify-between font-medium">
                        <span class="text-slate-500"
                            >Subtotal ({{ cartStore.totalUnits }} Items)</span
                        >
                        <span class="text-slate-900 font-bold">{{
                            currency(subtotal)
                        }}</span>
                    </div>
                    <div
                        v-if="discountPercent > 0"
                        class="flex justify-between text-emerald-600 font-semibold"
                    >
                        <span>Discount ({{ discountPercent }}%)</span>
                        <span>-{{ currency(discountAmount) }}</span>
                    </div>
                    <div class="flex justify-between font-medium">
                        <span class="text-slate-500"
                            >Grocery Sales Tax (Exempt)</span
                        >
                        <span class="text-slate-900 font-bold">{{
                            currency(0)
                        }}</span>
                    </div>
                </div>

                <div
                    class="p-5 rounded-2xl bg-slate-50 border border-slate-200 shadow-2xs mt-3"
                >
                    <span
                        class="text-[11px] font-black uppercase tracking-wider text-slate-500"
                    >
                        Amount Due
                    </span>
                    <div class="flex items-baseline justify-between mt-1.5">
                        <span
                            class="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight"
                        >
                            {{ currency(total) }}
                        </span>
                        <span
                            class="text-xs font-bold text-slate-700 bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs"
                        >
                            {{ cartStore.totalUnits }} Units
                        </span>
                    </div>
                </div>
            </div>

            <div class="p-6 pt-0 space-y-3">
                <button
                    type="button"
                    class="w-full py-3.5 px-5 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-extrabold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-xs transition-all"
                    :disabled="cartStore.items.length === 0"
                    @click="openCheckout()"
                >
                    <CreditCard class="w-5 h-5" />
                    <span>Tender & Charge ({{ currency(total) }})</span>
                    <ArrowRight class="w-4 h-4 ml-1" />
                </button>

                <div class="grid grid-cols-1 gap-2">
                    <button
                        type="button"
                        class="py-2.5 px-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 flex items-center justify-center gap-1 transition-colors active:scale-[0.98]"
                        :disabled="cartStore.items.length === 0"
                        @click="openCheckout('SPLIT')"
                    >
                        <Split class="w-3.5 h-3.5 text-emerald-600" />
                        <span>Split Payment</span>
                    </button>
                </div>
            </div>
        </div>

        <CheckoutModal
            v-model="isCheckoutOpen"
            :subtotal="subtotal"
            :discount-percent="discountPercent"
            :initial-method="checkoutMethod"
            @complete="completeSale"
        />

        <ReceiptModal
            v-model="isReceiptOpen"
            :receipt="receipt"
            :subtotal="receiptSubtotal"
            :discount-amount="receiptDiscount"
            :total="receiptTotal"
            :payment="paymentInfo"
            @new-sale="onNewSale"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { isAxiosError } from 'axios';
import {
    AlertCircle,
    ArrowDownLeft,
    ArrowRight,
    ArrowUpRight,
    Barcode,
    Calculator,
    CheckCircle2,
    CreditCard,
    Minus,
    Percent,
    Plus,
    Search,
    ShoppingBag,
    Split,
    Trash2,
    X,
} from '@lucide/vue';
import api from '@/axios';
import { useCartStore } from '@/stores/cart';
import { Color, useUIStore } from '@/stores/ui';
import { useShiftStore } from '@/stores/shift';
import CheckoutModal from '@/components/User/Sales/CheckoutModal.vue';
import ReceiptModal from '@/components/User/Sales/ReceiptModal.vue';
import type {
    PaymentInfo,
    PaymentMethod,
    Receipt,
} from '@/components/User/Sales/types';
import { formatCurrency } from '@/utils/currency';

interface Match {
    product: string;
    EAN: string;
    name: string;
}

interface Product {
    _id: string;
    EAN: string;
    name: string;
    price: number;
}

const cartStore = useCartStore();
const uiStore = useUIStore();
const shiftStore = useShiftStore();

const scanInput = ref<HTMLInputElement | null>(null);
const searchQuery = ref('');
const scanMultiplier = ref(1);
const matches = ref<Match[]>([]);
const scanFeedback = ref<{ type: 'success' | 'error'; message: string } | null>(
    null,
);
const showDiscount = ref(false);
const discountPercent = ref(0);
const isCheckoutOpen = ref(false);
const isReceiptOpen = ref(false);
const checkoutMethod = ref<PaymentMethod>('CASH');

const receipt = ref<Receipt | null>(null);
const receiptSubtotal = ref(0);
const receiptDiscount = ref(0);
const receiptTotal = ref(0);
const paymentInfo = ref<PaymentInfo | null>(null);

const qtyOptions = [1, 2, 3, 4, 5, 6, 8, 10, 12, 24];
const discountOptions = [0, 5, 10, 15, 20];

const subtotal = computed(() => cartStore.subtotal);
const discountAmount = computed(
    () => (subtotal.value * discountPercent.value) / 100,
);
const total = computed(() => subtotal.value - discountAmount.value);

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

function currency(value: number): string {
    return formatCurrency(value);
}

function showFeedback(type: 'success' | 'error', message: string) {
    scanFeedback.value = { type, message };
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
        scanFeedback.value = null;
    }, 2500);
}

function resetQuery() {
    searchQuery.value = '';
    matches.value = [];
    scanMultiplier.value = 1;
    scanInput.value?.focus();
}

function onSearchChange() {
    if (searchTimer) clearTimeout(searchTimer);
    if (!searchQuery.value.trim()) {
        matches.value = [];
        return;
    }
    searchTimer = setTimeout(() => fetchMatches(searchQuery.value), 250);
}

async function fetchMatches(name: string) {
    try {
        const res = await api.get('/products/matches', {
            params: { name: name.toUpperCase() },
        });
        matches.value = res.data;
    } catch {
        matches.value = [];
    }
}

async function onScanSubmit() {
    const raw = searchQuery.value.trim();
    if (!raw) return;

    let qty = scanMultiplier.value;
    let query = raw;

    if (raw.includes('*')) {
        const parts = raw.split('*');
        const parsed = parseInt(parts[0].trim(), 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            qty = parsed;
            query = parts.slice(1).join('*').trim();
        }
    }

    try {
        const res = await api.get(`/products/${encodeURIComponent(query)}`);
        addProduct(res.data, qty);
    } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) {
            showFeedback('error', `Barcode / code "${query}" not found`);
        } else {
            showFeedback('error', 'Could not look up that code');
        }
    }
}

async function selectMatch(match: Match) {
    try {
        const res = await api.get(`/products/${encodeURIComponent(match.EAN)}`);
        addProduct(res.data, scanMultiplier.value);
    } catch {
        showFeedback('error', `"${match.name}" could not be added`);
    }
}

function addProduct(product: Product, quantity: number) {
    cartStore.add(
        {
            product: product._id,
            EAN: product.EAN,
            name: product.name,
            unitPrice: product.price,
        },
        quantity,
    );
    showFeedback(
        'success',
        `Scanned: ${quantity > 1 ? `${quantity}x ` : ''}${product.name}`,
    );
    resetQuery();
}

function voidTicket() {
    cartStore.clear();
    discountPercent.value = 0;
    showDiscount.value = false;
}

function applyDiscount(value: number) {
    discountPercent.value = value;
    if (value === 0) showDiscount.value = false;
}

function openCheckout(method: PaymentMethod = 'CASH') {
    checkoutMethod.value = method;
    isCheckoutOpen.value = true;
}

async function completeSale(payment: PaymentInfo) {
    const sellDetails = cartStore.items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
    }));

    try {
        const res = await api.post('/sales', {
            paymentType: payment.method === 'SPLIT' ? 'GCASH' : payment.method,
            referenceNumber: payment.referenceNumber || undefined,
            sellDetails,
        });

        receipt.value = res.data;
        receiptSubtotal.value = subtotal.value;
        receiptDiscount.value = discountAmount.value;
        receiptTotal.value = total.value;
        paymentInfo.value = payment;

        const cashPortion =
            payment.method === 'CASH'
                ? total.value
                : payment.method === 'SPLIT'
                  ? (payment.split?.cashAmount ?? 0)
                  : 0;
        shiftStore.recordCashSale(cashPortion);

        cartStore.clear();
        discountPercent.value = 0;
        showDiscount.value = false;
        isReceiptOpen.value = true;
    } catch (error) {
        if (isAxiosError(error)) {
            uiStore.queueMessage(
                Color.ERROR,
                error.response?.data?.message ?? 'Sale failed',
            );
        } else {
            uiStore.queueMessage(Color.ERROR, 'Sale failed');
        }
    }
}

function onNewSale() {
    isReceiptOpen.value = false;
    receipt.value = null;
    paymentInfo.value = null;
    scanInput.value?.focus();
}

onMounted(() => {
    scanInput.value?.focus();
});

onBeforeUnmount(() => {
    if (searchTimer) clearTimeout(searchTimer);
    if (feedbackTimer) clearTimeout(feedbackTimer);
});
</script>
