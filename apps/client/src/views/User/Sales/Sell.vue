<template>
    <!-- Any click on the page gives the focus back to the scan box (#22). -->
    <div
        class="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden bg-paper text-ink"
        @click="sticky.onPageClick"
    >
        <!-- LEFT: scan input + live ticket (+ the tender footer below lg) -->
        <div
            ref="ticketColumn"
            class="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-surface"
        >
            <div class="p-4 sm:p-5 bg-surface shrink-0 border-b border-line">
                <div
                    class="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-line"
                >
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span
                                v-if="shiftStore.activeShift"
                                class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-success-bg text-success-fg border border-success-border text-xs font-bold"
                            >
                                <span>Shift Active</span>
                            </span>
                            <span
                                v-else
                                class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-warning-bg text-warning-fg border border-warning-border text-xs font-bold"
                            >
                                <AlertCircle
                                    class="w-3.5 h-3.5"
                                    aria-hidden="true"
                                />
                                <span>No Active Shift</span>
                            </span>
                        </div>
                        <h1
                            class="font-display text-xl sm:text-2xl font-[800] text-ink tracking-tight mt-1"
                        >
                            Checkout Register
                        </h1>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            class="min-h-11 px-3 py-2 rounded-control bg-surface hover:bg-paper border border-line-strong text-ink text-xs font-bold focus-ring disabled:opacity-40"
                            :disabled="
                                isTicketLocked ||
                                !cartStore.items.length ||
                                !shiftStore.activeShift
                            "
                            @click="openPark"
                        >
                            Park Ticket
                        </button>
                        <button
                            type="button"
                            class="min-h-11 px-3 py-2 rounded-control bg-surface hover:bg-paper border border-line-strong text-ink text-xs font-bold focus-ring disabled:opacity-40"
                            :disabled="isTicketLocked"
                            @click="parkedOpen = true"
                        >
                            Parked ({{ cartStore.parked.length }})
                        </button>
                        <template v-if="shiftStore.activeShift">
                            <button
                                type="button"
                                class="min-h-11 px-3 py-2 rounded-control bg-success-bg hover:bg-leaf-100 border border-success-border text-success-fg text-xs font-bold flex items-center gap-1.5 transition-colors focus-ring"
                                title="Add change when drawer coins or small bills run low"
                                @click="
                                    shiftStore.drawerAction =
                                        DrawerMovementType.CASH_IN
                                "
                            >
                                <ArrowDownLeft
                                    class="w-3.5 h-3.5"
                                    aria-hidden="true"
                                />
                                <span>+ Cash In</span>
                            </button>

                            <button
                                type="button"
                                class="min-h-11 px-3 py-2 rounded-control bg-warning-bg hover:bg-citrus-100 border border-warning-border text-warning-fg text-xs font-bold flex items-center gap-1.5 transition-colors focus-ring"
                                title="Drop excess cash safely to the back office safe"
                                @click="
                                    shiftStore.drawerAction =
                                        DrawerMovementType.CASH_DROP
                                "
                            >
                                <ArrowUpRight
                                    class="w-3.5 h-3.5"
                                    aria-hidden="true"
                                />
                                <span>- Cash Drop</span>
                            </button>

                            <button
                                type="button"
                                class="min-h-11 px-3 py-2 rounded-control bg-danger-bg hover:bg-surface border border-danger-border text-danger-fg text-xs font-bold flex items-center gap-1.5 transition-colors focus-ring"
                                title="Count physical cash in drawer, generate Z-Read report"
                                @click="shiftStore.shiftOutOpen = true"
                            >
                                <Calculator
                                    class="w-3.5 h-3.5"
                                    aria-hidden="true"
                                />
                                <span>End Shift</span>
                            </button>
                        </template>
                    </div>
                </div>

                <RegisterScanBox
                    ref="scanBox"
                    v-model="searchQuery"
                    :locked="isTicketLocked"
                    :match-count="search.matches.value.length"
                    :matches-settled="search.settled.value"
                    :next-scan-qty="nextScanQty"
                    :scan-feedback="scanFeedback"
                    @submit="onScanSubmit"
                    @search-change="onSearchChange"
                    @enter-matches="matchesList?.focusOption(0)"
                    @clear="clearQuery"
                />
            </div>

            <!-- Live matches -->
            <RegisterMatches
                v-if="searchQuery.trim().length > 0"
                ref="matchesList"
                :matches="search.matches.value"
                :highlighted="search.highlighted.value"
                :settled="search.settled.value"
                :error="search.error.value"
                :term="searchTerm"
                :locked="isTicketLocked"
                @select="onMatchPicked"
                @highlight="(i) => (search.highlighted.value = i)"
                @exit="backToScanBox"
            />

            <!-- Ticket table -->
            <RegisterTicket
                :items="cartStore.items"
                :total-units="cartStore.totalUnits"
                :locked="isTicketLocked"
                :selected-line="selectedLine"
                :qty-drafts="qtyDrafts"
                :qty-errors="qtyErrors"
                :undo="undo"
                :set-line-el="setLineEl"
                :set-qty-el="setQtyEl"
                @void="voidTicket"
                @select="(product) => (selectedLine = product)"
                @line-click="onLineClick"
                @move="moveSelection"
                @increment="increment"
                @decrement="decrement"
                @qty-input="onQtyInput"
                @qty-commit="commitQuantity"
                @qty-enter="onQtyEnter"
                @qty-scan="onQtyScan"
                @qty-cancel="cancelQuantity"
                @remove="removeLine"
                @undo="undoRemove"
            />

            <!--
                Below lg (product decision 2026-09-25, #26): the total and
                a button that opens the tender panel as a sheet over the
                ticket. The ticket above takes the rest and scrolls.
            -->
            <div
                v-if="!isLarge"
                data-testid="tender-footer"
                class="shrink-0 border-t border-line bg-surface px-4 py-3 flex items-center justify-between gap-3 shadow-overlay"
            >
                <div class="min-w-0">
                    <p
                        class="num text-xs font-bold uppercase tracking-wider text-muted"
                    >
                        Amount Due · {{ cartStore.totalUnits }} Units
                    </p>
                    <p
                        data-testid="footer-total"
                        class="font-display num text-2xl min-[360px]:text-3xl font-[800] text-ink tracking-tight truncate"
                    >
                        {{ currency(total) }}
                    </p>
                </div>
                <button
                    type="button"
                    data-testid="open-tender"
                    aria-haspopup="dialog"
                    :aria-expanded="tender.isSheet.value"
                    aria-controls="tender-panel"
                    class="min-h-11 min-w-11 px-5 py-3 bg-citrus-500 hover:bg-citrus-400 active:bg-citrus-600 active:scale-[0.98] text-ink rounded-card font-bold text-base flex items-center justify-center gap-2 shadow-card transition-all focus-ring shrink-0"
                    @click="tender.show()"
                >
                    <CreditCard class="w-5 h-5" aria-hidden="true" />
                    <span>Tender</span>
                </button>
            </div>
        </div>

        <!--
            RIGHT: the tender panel. From lg up it sits beside the ticket
            (the teleport is off, the wrapper is display: contents). Below
            lg it lives under <body> as a sheet on the modal stack, shown
            from the footer's Tender button (#26).
        -->
        <Teleport to="body" :disabled="isLarge">
            <div
                ref="tenderRoot"
                data-testid="tender-root"
                :class="
                    isLarge
                        ? 'contents'
                        : tender.isSheet.value
                          ? 'fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm'
                          : 'hidden'
                "
                @mousedown.self="tender.hide()"
            >
                <div
                    id="tender-panel"
                    ref="tenderPanel"
                    data-testid="tender-panel"
                    :role="isLarge ? undefined : 'dialog'"
                    :aria-modal="isLarge ? undefined : 'true'"
                    :aria-label="isLarge ? undefined : 'Tender'"
                    :tabindex="isLarge ? undefined : -1"
                    class="w-full lg:w-[400px] bg-surface lg:border-l border-line flex flex-col justify-between shrink-0 shadow-xs z-30 max-h-[90vh] overflow-y-auto rounded-t-2xl lg:max-h-none lg:overflow-visible lg:rounded-none focus:outline-none"
                >
                    <RegisterTenderPanel
                        ref="tenderControls"
                        v-model:fixed-text="fixedText"
                        v-model:discount-reason="discountReason"
                        :is-large="isLarge"
                        :locked="isTicketLocked"
                        :offline="offline.offline"
                        :show-discount="showDiscount"
                        :discount-options="discountOptions"
                        :discount-choice="discountChoice"
                        :discount-label="discountLabel"
                        :discount-amount="discountAmount"
                        :fixed-error-shown="fixedErrorShown"
                        :needs-reason="needsReason"
                        :total-units="cartStore.totalUnits"
                        :subtotal="subtotal"
                        :total="total"
                        :can-checkout="canCheckout"
                        @close="tender.hide()"
                        @toggle-discount="showDiscount = !showDiscount"
                        @apply-discount="applyDiscount"
                        @checkout="openCheckout"
                    />
                </div>
            </div>
        </Teleport>

        <BaseModal
            v-model="parkOpen"
            title="Park ticket"
            subtitle="Save this ticket while you serve another customer."
        >
            <label for="park-note" class="block text-sm font-bold mb-2"
                >Label or customer note (optional)</label
            >
            <input
                id="park-note"
                v-model="parkNote"
                :maxlength="PARKED_LABEL_MAX"
                class="w-full min-h-11 border border-line-strong rounded-control px-3 text-sm focus-ring"
                @keydown.enter.prevent="parkTicket"
            />
            <p
                v-if="parkError"
                role="alert"
                class="mt-3 text-sm text-danger-fg"
            >
                {{ parkError }}
            </p>
            <template #footer
                ><BaseButton variant="outline" @click="parkOpen = false"
                    >Keep Ticket</BaseButton
                ><BaseButton @click="parkTicket"
                    >Park Ticket</BaseButton
                ></template
            >
        </BaseModal>
        <ParkedTicketsDialog v-model="parkedOpen" @resumed="resetTicketUi" />

        <CheckoutModal
            v-model="isCheckoutOpen"
            :total="total"
            :initial-method="checkoutMethod"
            :cash-only="offline.offline || !offline.connected"
            :submit="submitSale"
        />

        <ConfirmDialog :request="confirmRequest" @answer="answerConfirm" />

        <ReceiptModal
            v-model="isReceiptOpen"
            :receipt="receipt"
            :notice="receiptNotice"
            @new-sale="onNewSale"
            @scan="onReceiptScan"
        />
    </div>
    <ManagerOverrideDialog
        v-model="isApprovalOpen"
        :request="approvalRequest"
        :summary="approvalSummary"
        @approved="completeApproval"
        @cancel="cancelApproval"
    />
</template>

<script setup lang="ts">
import { quantityError as quantityFieldError } from '@/utils/rules';
import {
    quantityInput,
    quantityScale,
    parseQuantity,
} from '@grocery-pos/contracts';
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    shallowRef,
    useTemplateRef,
    watch,
    watchEffect,
} from 'vue';
import {
    AlertCircle,
    ArrowDownLeft,
    ArrowUpRight,
    Calculator,
    CreditCard,
} from '@lucide/vue';
import api from '@/axios';
import { isAxiosError } from 'axios';
import { useOfflineStore } from '@/stores/offline';
import BaseModal from '@/components/ui/BaseModal.vue';
import { anyModalOpen } from '@/components/ui/modal-stack';
import BaseButton from '@/components/ui/BaseButton.vue';
import ParkedTicketsDialog from '@/components/User/Sales/ParkedTicketsDialog.vue';
import ManagerOverrideDialog from '@/components/User/Sales/ManagerOverrideDialog.vue';
import { useManagerApproval } from '@/composables/useManagerApproval';

import {
    type CartItem,
    PARKED_LABEL_MAX,
    TICKET_AMOUNT_MAX,
    useCartStore,
} from '@/stores/cart';
import { useShiftStore } from '@/stores/shift';
import { apiErrorCode } from '@/utils/api-error';
import { Color, REGISTER_TOAST_IDLE, useUIStore } from '@/stores/ui';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import CheckoutModal from '@/components/User/Sales/CheckoutModal.vue';
import ReceiptModal from '@/components/User/Sales/ReceiptModal.vue';
import RegisterScanBox from '@/components/User/Sales/RegisterScanBox.vue';
import RegisterMatches from '@/components/User/Sales/RegisterMatches.vue';
import RegisterTicket from '@/components/User/Sales/RegisterTicket.vue';
import RegisterTenderPanel from '@/components/User/Sales/RegisterTenderPanel.vue';
import {
    fixedDiscountError,
    paymentLabel,
    previewSale,
} from '@/components/User/Sales/checkout';
import { voidTicketMessage } from '@/components/User/Sales/ticket';
import {
    isRejectedSale,
    saleErrorMessage,
    useSaleCheckout,
} from '@/components/User/Sales/sale-submission';
import {
    isBarcode,
    type Match,
    parseScan,
    useProductSearch,
} from '@/components/User/Sales/product-search';
import {
    centavosToPesoInput,
    formatCurrency,
    parsePesos,
} from '@/utils/currency';
import { toSaleTicket } from '@/utils/payloads';
import {
    isTextEntry,
    REGISTER_KEYS,
    useRegisterShortcuts,
} from '@/composables/useRegisterShortcuts';
import { useStickyFocus } from '@/composables/useStickyFocus';
import { useIsLarge } from '@/composables/useMediaQuery';
import { useTenderSheet } from '@/composables/useTenderSheet';
import { useElementBox } from '@/composables/useElementBox';
import { useConfirm } from '@/composables/useConfirm';
import {
    DiscountType,
    type DiscountInput,
    DrawerMovementType,
    ErrorCode,
    OverrideAction,
    type PaymentRequest,
    PaymentType,
    type ProductView,
    type Receipt,
} from '@grocery-pos/contracts';

/** How long a removed line can be put back (decision 2026-09-25, #23). */
const UNDO_MS = 5000;
/** How long a scan success stays; an error stays until the next scan. */
const SUCCESS_MS = 2500;

const PRICES_CHANGED_NOTICE =
    'Prices changed since scanning; the sale summary shows the charged amounts.';

const cartStore = useCartStore();
const uiStore = useUIStore();
const shiftStore = useShiftStore();

const scanBox = useTemplateRef<{ input: HTMLInputElement | null }>('scanBox');
const scanInput = computed(() => scanBox.value?.input ?? null);
const matchesList = useTemplateRef<{ focusOption: (index: number) => void }>(
    'matchesList',
);
/** Side by side from lg up; below lg the tender panel is a sheet (#26). */
const isLarge = useIsLarge();
const tender = useTenderSheet(
    isLarge,
    useTemplateRef<HTMLElement>('tenderRoot'),
    useTemplateRef<HTMLElement>('tenderPanel'),
);
const tenderControls = useTemplateRef<{
    discountOptionsEl: HTMLElement | null;
    fixedInput: HTMLInputElement | null;
    reasonInput: HTMLInputElement | null;
}>('tenderControls');
const reasonInput = computed(() => tenderControls.value?.reasonInput ?? null);
const fixedInput = computed(() => tenderControls.value?.fixedInput ?? null);
const discountOptionsEl = computed(
    () => tenderControls.value?.discountOptionsEl ?? null,
);
// A ticket line the cashier clicked keeps the focus, so Delete can remove
// it; a printable key typed there still goes to the scan box.
const sticky = useStickyFocus(() => scanInput.value, {
    keepOnClick: (el) => el.matches('[data-ticket-line]'),
    holdsFocus: (el) => tender.holdsFocus(el),
});
const offline = useOfflineStore();
const searchQuery = ref('');
const search = useProductSearch(
    async (name, signal) => {
        if (offline.offline) return offline.matches(name);
        try {
            return (
                await api.get<Match[]>('/products/matches', {
                    params: { name },
                    signal,
                })
            ).data;
        } catch (cause) {
            if (isAxiosError(cause) && !cause.response && !signal.aborted) {
                offline.setConnection(false);
                return offline.matches(name);
            }
            throw cause;
        }
    },
    () => searchTerm.value,
);
/** What the live search looks for: the input minus any `<qty>*` prefix. */
const searchTerm = computed(() => parseScan(searchQuery.value, 1).query);
/** The quantity the next scan adds: a typed `12*`, else 1. */
const nextScanQty = computed(() => parseScan(searchQuery.value, 1).qty);
const scanFeedback = ref<{ type: 'success' | 'error'; message: string } | null>(
    null,
);
const isCheckoutOpen = ref(false);
const isReceiptOpen = ref(false);
const checkoutMethod = ref<PaymentType>(PaymentType.CASH);

// The server's response: the receipt and drawer read its totals, never the
// preview below.
const receipt = ref<Receipt | null>(null);
/** Shown on the receipt when the sale had already been recorded earlier. */
const receiptNotice = ref<string | null>(null);

const discountOptions = [0, 5, 10, 15, 20];

// ---- Discount: kept with the cart, so it survives leaving the page and a
// refresh (#23). A FIXED value is centavos; 0 means not typed yet.

/** The picked option: 0 (none), a percent, or FIXED. */
const discountChoice = computed<number | DiscountType.FIXED>(() => {
    const d = cartStore.discount;
    if (!d) return 0;
    return d.type === DiscountType.FIXED ? DiscountType.FIXED : d.value;
});
const showDiscount = ref(cartStore.discount !== null);
/** The typed fixed amount, in pesos. */
const fixedText = ref(
    cartStore.discount?.type === DiscountType.FIXED && cartStore.discount.value
        ? centavosToPesoInput(cartStore.discount.value)
        : '',
);
const fixedError = computed(() =>
    discountChoice.value === DiscountType.FIXED
        ? fixedDiscountError(fixedText.value, cartStore.subtotal)
        : '',
);
/** Shown once something is typed: an untouched field is only "required". */
const fixedErrorShown = computed(() =>
    fixedText.value.trim() ? fixedError.value : '',
);

watch(fixedText, (text) => {
    const d = cartStore.discount;
    if (d?.type !== DiscountType.FIXED) return;
    const centavos = parsePesos(text);
    cartStore.setDiscount({
        ...d,
        value: centavos !== null && centavos > 0 ? centavos : 0,
    });
});

// The discount changed outside this page (another tab, #23 review): show
// it. Typing here round-trips through the store and changes nothing.
watch(
    () => cartStore.discount,
    (d, before) => {
        if (d && !before) showDiscount.value = true;
        if (d?.type !== DiscountType.FIXED) return;
        const typed = parsePesos(fixedText.value);
        if ((typed !== null && typed > 0 ? typed : 0) !== d.value) {
            fixedText.value = d.value ? centavosToPesoInput(d.value) : '';
        }
    },
    { deep: true },
);

const discountReason = computed({
    get: () => cartStore.discount?.reason ?? '',
    set: (reason: string) => {
        const d = cartStore.discount;
        if (d) cartStore.setDiscount({ ...d, reason });
    },
});

const discountRequest = computed<DiscountInput | null>(() => {
    const d = cartStore.discount;
    return d ? { type: d.type, value: d.value, reason: d.reason.trim() } : null;
});
const discountLabel = computed(() => {
    const d = cartStore.discount;
    if (!d || d.value <= 0) return '';
    return d.type === DiscountType.PERCENT
        ? `${d.value}%`
        : formatCurrency(d.value);
});
// Preview for display and tendering only; the server computes the charge.
const preview = computed(() =>
    previewSale(cartStore.subtotal, discountRequest.value),
);
const subtotal = computed(() => preview.value.subtotal);
const discountAmount = computed(() => preview.value.discountAmount);
const total = computed(() => preview.value.total);
const needsReason = computed(
    () => discountRequest.value !== null && !discountRequest.value.reason,
);

// ---- Ticket lines (#23)

/** The selected line's product: scanned last, or clicked. */
const selectedLine = ref<string | null>(null);
/** Quantities being typed, by product, until they are committed. */
const qtyDrafts = reactive<Record<string, string>>({});
const lineEls = new Map<string, HTMLElement>();
const qtyEls = new Map<string, HTMLInputElement>();

/** Why a typed quantity is refused (`@IsInt() @Min(1)`), or ''. */
function quantityError(product: string, text: string): string {
    const item = cartStore.items.find((i) => i.product === product);
    if (!item) return '';
    const error = quantityFieldError(text, item.unit);
    if (error) return error;
    const value = parseQuantity(text, item.unit)!;
    // A line gone (e.g. removed in another tab) has nothing to check.
    if (!item) return '';
    const max = cartStore.maxQuantity(product, item.unitPrice);
    return value > max
        ? `At most ${max}: a sale can't exceed ${formatCurrency(TICKET_AMOUNT_MAX)}`
        : '';
}

const qtyErrors = computed<Record<string, string>>(() =>
    Object.fromEntries(
        Object.entries(qtyDrafts)
            .map(([product, text]): [string, string] => [
                product,
                quantityError(product, text),
            ])
            .filter(([, error]) => error),
    ),
);

const canCheckout = computed(
    () =>
        cartStore.items.length > 0 &&
        !needsReason.value &&
        !fixedError.value &&
        Object.keys(qtyErrors.value).length === 0 &&
        preview.value.isChargeable,
);

function setLineEl(product: string, el: HTMLElement | null) {
    if (el) lineEls.set(product, el);
    else lineEls.delete(product);
}

function setQtyEl(product: string, el: HTMLInputElement | null) {
    if (el) qtyEls.set(product, el);
    else qtyEls.delete(product);
}

function onLineClick(product: string, event: MouseEvent) {
    selectedLine.value = product;
    // A click on the row itself (not its buttons or quantity) takes the
    // focus, so Delete removes it.
    const target = event.target as HTMLElement | null;
    if (!target?.closest('button, input')) {
        lineEls.get(product)?.focus({ preventScroll: true });
    }
}

function moveSelection(delta: number) {
    const items = cartStore.items;
    if (!items.length) return;
    const at = items.findIndex((i) => i.product === selectedLine.value);
    const next = Math.min(Math.max(at + delta, 0), items.length - 1);
    selectedLine.value = items[next].product;
    lineEls.get(items[next].product)?.focus({ preventScroll: true });
}

function onQtyInput(product: string, event: Event) {
    qtyDrafts[product] = (event.target as HTMLInputElement).value;
}

/** Applies a typed quantity; false (and the error shown) when refused. */
function commitQuantity(product: string): boolean {
    const text = qtyDrafts[product];
    if (text === undefined) return true;
    if (quantityError(product, text)) return false;
    cartStore.setQuantity(
        product,
        parseQuantity(
            text,
            cartStore.items.find((i) => i.product === product)?.unit,
        )!,
    );
    delete qtyDrafts[product];
    return true;
}

function onQtyEnter(product: string) {
    if (commitQuantity(product)) scanInput.value?.focus();
}

/**
 * A scanner burst while a quantity had the focus (#323): the typed
 * quantity is committed (a refused one keeps its error and the line its
 * last quantity), then the code goes through the scan box's own flow.
 */
function onQtyScan(product: string, code: string) {
    commitQuantity(product);
    searchQuery.value = code;
    void onScanSubmit();
}

/** Escape: back to the line's quantity, and the focus to the line. */
function cancelQuantity(product: string) {
    delete qtyDrafts[product];
    const qty = qtyEls.get(product);
    const item = cartStore.items.find((i) => i.product === product);
    if (qty && item) qty.value = quantityInput(item.quantity, item.unit);
    lineEls.get(product)?.focus({ preventScroll: true });
}

/** F4: the selected line's quantity, else the last line's. */
function focusLineQuantity() {
    const items = cartStore.items;
    if (!items.length || isTicketLocked.value) return;
    const product = items.some((i) => i.product === selectedLine.value)
        ? selectedLine.value!
        : items[items.length - 1].product;
    selectedLine.value = product;
    // F4 on the field being typed in commits it first (#323 review).
    commitQuantity(product);
    const qty = qtyEls.get(product);
    qty?.focus();
    qty?.select();
}

function increment(item: CartItem) {
    selectedLine.value = item.product;
    delete qtyDrafts[item.product];
    cartStore.setQuantity(
        item.product,
        item.quantity + quantityScale(item.unit),
    );
}

function decrement(item: CartItem) {
    selectedLine.value = item.product;
    delete qtyDrafts[item.product];
    if (item.quantity <= quantityScale(item.unit)) removeLine(item.product);
    else
        cartStore.setQuantity(
            item.product,
            item.quantity - quantityScale(item.unit),
        );
}

// ---- Line removal with Undo (decision 2026-09-25, #23)

const undo = shallowRef<{ item: CartItem; index: number } | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

function dismissUndo() {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = undefined;
    undo.value = null;
}

/** Removes a line at once; it can be put back for UNDO_MS. */
function removeLine(product: string) {
    if (cartStore.locked) return;
    const hadFocus = lineEls.get(product)?.contains(document.activeElement);
    const removed = cartStore.remove(product);
    if (!removed) return;
    delete qtyDrafts[product];

    dismissUndo();
    undo.value = removed;
    undoTimer = setTimeout(dismissUndo, UNDO_MS);

    // The selection moves to the line that took its place (or the one
    // before), so Delete can go on removing.
    const items = cartStore.items;
    const next = items[removed.index] ?? items[removed.index - 1] ?? null;
    selectedLine.value = next?.product ?? null;
    if (hadFocus) {
        void nextTick(() => {
            const el = next && lineEls.get(next.product);
            if (el) el.focus({ preventScroll: true });
            else scanInput.value?.focus();
        });
    }
}

/**
 * What Delete removes (#23, #85): the line the focus is on (the line or
 * one of its buttons, not its quantity field), or, from the empty scan
 * box, the highlighted line (the one just scanned, `selectedLine`), else
 * the last line. Nothing from the discount, the Qty picker, nowhere, a
 * scan box with text (Delete edits it) or the tender sheet.
 */
function deleteTarget(): string | null {
    // The sheet's focus trap keeps the focus out of the ticket anyway.
    if (cartStore.locked || tender.isTop()) return null;
    const active = document.activeElement;
    if (active && active === scanInput.value) {
        if (searchQuery.value !== '') return null;
        // What is highlighted is what goes: every scan selects its line,
        // a repeat scan too (it merges in place). New lines are appended,
        // so the last one is the fallback.
        const items = cartStore.items;
        const selected = items.find((i) => i.product === selectedLine.value);
        return (selected ?? items[items.length - 1])?.product ?? null;
    }
    if (isTextEntry(active)) return null;
    // The line the focus is on, which focusing it also selected.
    return (
        active?.closest<HTMLElement>('[data-ticket-line]')?.dataset.product ??
        null
    );
}

function removeSelected() {
    const product = deleteTarget();
    if (product) removeLine(product);
}

function undoRemove() {
    const removed = undo.value;
    dismissUndo();
    if (!removed) return;
    if (cartStore.restore(removed.item, removed.index)) {
        selectedLine.value = removed.item.product;
    } else if (
        !cartStore.items.some((i) => i.product === removed.item.product)
    ) {
        uiStore.queueMessage(
            Color.ERROR,
            `Couldn't put back ${removed.item.quantity}x ${removed.item.name}: a sale can't exceed ${formatCurrency(TICKET_AMOUNT_MAX)}.`,
        );
    }
    scanInput.value?.focus();
}

/**
 * Lines can go without this page removing them: another tab's sale, void
 * or edit (#23 review). What the page kept for them goes too: a typed
 * quantity (it would hold the charge with no field to show why), the
 * selection and a pending Undo.
 */
watch(
    () => cartStore.items.map((i) => i.product),
    (products) => {
        const onTicket = new Set(products);
        for (const product of Object.keys(qtyDrafts)) {
            if (!onTicket.has(product)) delete qtyDrafts[product];
        }
        if (selectedLine.value && !onTicket.has(selectedLine.value)) {
            selectedLine.value = null;
        }
    },
);
// ---- Toasts keep clear of the register (#85): centred on the ticket
// column (it moves with the sidebar), at the top while the tender sheet is
// open (its Tender & Charge is at the bottom), and above the Undo bar.

const ticketColumn = useElementBox(useTemplateRef<HTMLElement>('ticketColumn'));
watchEffect(() => {
    uiStore.registerToast = {
        sheetOpen: tender.isSheet.value,
        undoShown: undo.value !== null,
        column: ticketColumn.value,
    };
});
onBeforeUnmount(() => {
    uiStore.registerToast = { ...REGISTER_TOAST_IDLE };
});

// Another tab replaced the basket: an Undo from before would put a line
// back into a ticket it no longer belongs to.
watch(() => cartStore.remoteChanges, dismissUndo);

// ---- Scanning

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

function currency(value: number): string {
    return formatCurrency(value);
}

function showFeedback(type: 'success' | 'error', message: string) {
    scanFeedback.value = { type, message };
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = undefined;
    if (type === 'success') {
        feedbackTimer = setTimeout(() => {
            scanFeedback.value = null;
        }, SUCCESS_MS);
    }
}

/** A new scan starts: the last one's message goes. */
function clearFeedback() {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = undefined;
    scanFeedback.value = null;
}

function cancelPendingSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = undefined;
}

/**
 * Clears the input after an item is added, but only if it still holds the
 * text that was submitted: a scanner can start the next barcode while this
 * lookup is in flight, and those digits must survive. A `12*` prefix
 * goes with the text, so it was for this scan only (#23).
 */
function resetQuery(submitted: string) {
    if (searchQuery.value !== submitted) return;
    cancelPendingSearch();
    search.reset();
    searchQuery.value = '';
}

/**
 * A match clicked, or Enter/Space on the focused one (#322): the focus
 * waits in the scan box, and the added line's quantity takes it (#323).
 */
function onMatchPicked(match: Match) {
    scanInput.value?.focus();
    void selectMatch(match, nextScanQty.value);
}

/** Escape, or ↑ from the top row of the matches: the text stays (#322). */
function backToScanBox() {
    search.highlighted.value = -1;
    scanInput.value?.focus();
}

function clearQuery() {
    cancelPendingSearch();
    search.reset();
    searchQuery.value = '';
    scanInput.value?.focus();
}

function onSearchChange() {
    cancelPendingSearch();
    // A highlight picked for the previous text must not ride along to Enter.
    search.highlighted.value = -1;
    const term = searchTerm.value;
    if (!term) {
        search.reset();
        return;
    }
    searchTimer = setTimeout(() => {
        searchTimer = undefined;
        void search.search(term);
    }, 250);
}

// The register's own match list keeps the highlighted option in view (#23).
watch(
    () => search.highlighted.value,
    async (index) => {
        if (index < 0) return;
        await nextTick();
        document
            .getElementById(`product-match-${index}`)
            ?.scrollIntoView?.({ block: 'nearest' });
    },
);

/**
 * Enter / the Scan button. In order:
 * 1. a highlighted match (picked with the arrow keys) is added;
 * 2. digits as long as a barcode (13, 12 or 8, `isBarcode`) are looked up
 *    exactly first, as a scanner expects, and a hit is added. The check
 *    digit is not checked, so a legacy code saved with a wrong one still
 *    scans. A miss falls through to the search (#87): the digits may be a
 *    typed fragment of a longer code;
 * 3. otherwise the input is searched now, and a single match of a *name*
 *    is added straight away. A digits-only fragment is never auto-added,
 *    even with one match: it may be the tail of a scan that lost its first
 *    digits, or a short number that happens to hit one product;
 * 4. every other outcome (a digit fragment, no match, several matches, a
 *    failed search) gets a message, and the cashier picks from the list.
 *    A barcode that missed and matches nothing says "Barcode … not found".
 * Nothing happens while the ticket is locked for checkout.
 */
async function onScanSubmit() {
    if (cartStore.locked) return;
    const submitted = searchQuery.value;
    const { qty, query } = parseScan(submitted, 1);
    if (!query) return;
    clearFeedback();

    const picked = search.highlightedMatch();
    if (picked) {
        await selectMatch(picked, qty, submitted);
        return;
    }

    const barcode = isBarcode(query);
    cancelPendingSearch();
    if (barcode) {
        const outcome = await lookUpBarcode(query, qty, submitted);
        if (outcome !== 'missing') return;
        // Retyped while the lookup ran: the live search for the new text
        // must not be cancelled by a search for the old one.
        if (searchTerm.value !== query) return;
    }

    const found = await search.search(query);
    // The input changed, was cleared, or a newer search (a second Enter)
    // took over: that one reports instead.
    if (searchTerm.value !== query || !search.settled.value) return;
    // Superseded (null without an error): the newer search reports.
    if (found === null && !search.error.value) return;

    if (found === null) {
        showFeedback(
            'error',
            `Couldn't search products: ${search.error.value}`,
        );
    } else if (found.length === 0) {
        showFeedback(
            'error',
            barcode
                ? `Barcode "${query}" not found`
                : `No item matching "${query}"`,
        );
    } else if (found.length === 1 && !/^\d+$/.test(query)) {
        await selectMatch(found[0], qty, submitted);
    } else {
        const count =
            found.length === 1
                ? '1 item matches'
                : `${found.length} items match`;
        showFeedback(
            'error',
            `${count} "${query}": pick it with ↓ and Enter, or click it`,
        );
    }
}

/**
 * The exact lookup of a barcode-shaped input: `added` when it was found
 * (and handed to `addProduct`), `missing` on PRODUCT_NOT_FOUND so the
 * caller searches instead, `failed` (reported here) on any other error.
 */
async function lookUpBarcode(
    EAN: string,
    qty: number,
    submitted: string,
): Promise<'added' | 'missing' | 'failed'> {
    const basket = cartStore.items;
    try {
        const res = offline.offline
            ? { data: await offline.product(EAN) }
            : await api.get<ProductView>(
                  `/products/${encodeURIComponent(EAN)}`,
              );
        if (basket !== cartStore.items) return 'failed';
        addProduct(res.data, qty, submitted);
        return 'added';
    } catch (error) {
        if (basket !== cartStore.items) return 'failed';
        if (isAxiosError(error) && !error.response) {
            offline.setConnection(false);
            try {
                const product = await offline.product(EAN);
                if (basket === cartStore.items) {
                    addProduct(product, qty, submitted);
                    return 'added';
                }
            } catch {
                /* No cached match; keep the ticket and explain below. */
            }
        }
        if (apiErrorCode(error) === ErrorCode.PRODUCT_NOT_FOUND) {
            return 'missing';
        }
        showFeedback('error', 'Could not look up that code');
        return 'failed';
    }
}

async function selectMatch(
    match: Match,
    qty: number,
    submitted = searchQuery.value,
) {
    if (cartStore.locked) return;
    const basket = cartStore.items;
    clearFeedback();
    try {
        const res = offline.offline
            ? { data: await offline.product(match.EAN) }
            : await api.get<ProductView>(
                  `/products/${encodeURIComponent(match.EAN)}`,
              );
        if (basket !== cartStore.items) return;
        addProduct(res.data, qty, submitted);
    } catch {
        if (basket !== cartStore.items) return;
        showFeedback('error', `"${match.name}" could not be added`);
    }
}

function addProduct(product: ProductView, quantity: number, submitted: string) {
    if (cartStore.locked) {
        showFeedback('error', 'Wait for the sale to finish recording');
        return;
    }
    const added = cartStore.add(
        {
            product: product._id,
            EAN: product.EAN,
            name: product.name,
            unitPrice: product.price,
            ...(product.unit && { unit: product.unit }),
        },
        quantity * quantityScale(product.unit),
    );
    if (!added) {
        // Nothing was added: the text (and any `12*`) stays for a retry.
        showFeedback(
            'error',
            `Can't add ${quantity}x ${product.name}: a sale can't exceed ${formatCurrency(TICKET_AMOUNT_MAX)}`,
        );
        return;
    }
    // Rung up again: the removed line is not put back on top of it.
    if (undo.value?.item.product === product._id) dismissUndo();
    selectedLine.value = product._id;
    showFeedback(
        'success',
        `Scanned: ${quantity > 1 ? `${quantity}x ` : ''}${product.name}`,
    );
    resetQuery(submitted);
    void focusAddedLine(product._id);
}

/**
 * After an add (#323): the line's quantity takes the focus with its value
 * selected, as F4 does, so typing replaces it and Enter goes back to the
 * scan box. Not while a modal is open or the ticket is locked.
 */
async function focusAddedLine(product: string) {
    await nextTick();
    if (anyModalOpen.value || isTicketLocked.value) return;
    if (selectedLine.value !== product) return;
    // The next scan already started in the box: its digits keep the focus.
    if (searchQuery.value !== '') return;
    const qty = qtyEls.get(product);
    qty?.focus();
    qty?.select();
}

// ---- Discount actions

/** Resets the discount's on-page state; the cart holds the discount. */
function resetDiscountUi() {
    fixedText.value = '';
    showDiscount.value = false;
}

function applyDiscount(choice: number | DiscountType.FIXED) {
    if (cartStore.locked) return;
    if (choice === 0) {
        cartStore.setDiscount(null);
        resetDiscountUi();
        return;
    }
    const reason = cartStore.discount?.reason ?? '';
    if (choice === DiscountType.FIXED) {
        const centavos = parsePesos(fixedText.value);
        cartStore.setDiscount({
            type: DiscountType.FIXED,
            value: centavos !== null && centavos > 0 ? centavos : 0,
            reason,
        });
        void focusField(fixedInput);
        return;
    }
    cartStore.setDiscount({
        type: DiscountType.PERCENT,
        value: choice,
        reason,
    });
    // The reason is required: take the cashier straight to it.
    if (!reason.trim()) void focusField(reasonInput);
}

async function focusField(field: { value: HTMLInputElement | null }) {
    await nextTick();
    field.value?.focus();
}

// ---- Parked tickets (#35)
const parkOpen = ref(false);
const parkedOpen = ref(false);
const parkNote = ref('');
const parkError = ref('');
function openPark() {
    if (cartStore.locked || !shiftStore.activeShift) return;
    if (!Object.keys(qtyDrafts).map(commitQuantity).every(Boolean)) return;
    parkNote.value = '';
    parkError.value = '';
    parkOpen.value = true;
}
function resetTicketUi() {
    cancelPendingSearch();
    clearFeedback();
    dismissUndo();
    selectedLine.value = null;
    resetDiscountUi();
    for (const id of Object.keys(qtyDrafts)) delete qtyDrafts[id];
    searchQuery.value = '';
    search.reset();
}
function parkTicket() {
    if (!shiftStore.activeShift) return;
    try {
        cartStore.park(parkNote.value, shiftStore.activeShift._id);
        parkOpen.value = false;
        resetTicketUi();
        uiStore.queueMessage(
            Color.SUCCESS,
            'Ticket parked. You can start the next sale.',
        );
    } catch (err) {
        parkError.value =
            err instanceof Error ? err.message : 'Could not park this ticket.';
    }
}

// ---- Void Ticket (decision 2026-09-25, #23: it asks first)

const {
    request: confirmRequest,
    confirm,
    answer: answerConfirm,
} = useConfirm();

async function voidTicket() {
    if (cartStore.locked || !cartStore.items.length) return;
    const ok = await confirm({
        title: 'Void Ticket',
        message: voidTicketMessage(
            cartStore.items.length,
            cartStore.totalUnits,
        ),
        confirmLabel: 'Void Ticket',
        cancelLabel: 'Keep Ticket',
        danger: true,
    });
    if (!ok || cartStore.locked) return;
    cartStore.clear();
    resetDiscountUi();
    dismissUndo();
    for (const product of Object.keys(qtyDrafts)) delete qtyDrafts[product];
    selectedLine.value = null;
    // An identical next ticket must not replay a sale this one may have
    // recorded before its response was lost.
    checkout.discardKey();
}

// ---- Checkout

function openCheckout(method: PaymentType = PaymentType.CASH) {
    if (
        offline.offline &&
        (method !== PaymentType.CASH || discountRequest.value)
    ) {
        showFeedback(
            'error',
            'Offline sales allow cash only and no discounts. Remove the discount or reconnect.',
        );
        return;
    }
    // A quantity still being typed (F9 from its field) counts first; the
    // checkout must tender the ticket as it will be sent.
    const typing = Object.keys(qtyDrafts);
    if (!typing.map(commitQuantity).every(Boolean) || !canCheckout.value) {
        return;
    }
    checkoutMethod.value = method;
    isCheckoutOpen.value = true;
}

const {
    isApprovalOpen,
    approvalRequest,
    approvalSummary,
    requestApproval,
    completeApproval,
    cancelApproval,
} = useManagerApproval();

const checkout = useSaleCheckout({
    cart: cartStore,
    ticket: () => toSaleTicket(cartStore.items, discountRequest.value),
    post: async (body) => {
        if (offline.offline) return offline.queue(body, cartStore.items);
        try {
            return (await api.post<Receipt>('/sales', body)).data;
        } catch (error) {
            if (apiErrorCode(error) !== ErrorCode.OVERRIDE_REQUIRED)
                throw error;
        }
        const token = await requestApproval(
            {
                action: OverrideAction.DISCOUNT,
                context: {
                    sale: body,
                    expectedSubtotal: cartStore.subtotal,
                },
            },
            `Approve discount of ${currency(discountAmount.value)} on subtotal ${currency(cartStore.subtotal)}. Reason: ${body.discount?.reason ?? ''}`,
        );
        if (!token)
            throw new Error('Manager approval cancelled. Nothing was charged.');
        return (
            await api.post<Receipt>('/sales', body, {
                headers: { 'X-Manager-Approval': token },
            })
        ).data;
    },
    // Saved with the basket (#23 review): a retry after a refresh or crash
    // mid-sale reuses the key, so the server replays the recorded sale.
    attemptStore: {
        get: () => cartStore.attempt,
        set: (attempt) => cartStore.setAttempt(attempt),
    },
});

/** True while `POST /sales` is in flight: the ticket cannot be edited. */
const isTicketLocked = computed(() => cartStore.locked);

// Nothing on the ticket may be undone or typed over once it is being sold.
watch(isTicketLocked, (locked) => {
    if (locked) dismissUndo();
});

/**
 * Called by the checkout modal, which stays open until this settles. A
 * rejection carries the message the modal shows inline.
 */
async function submitSale(payment: PaymentRequest) {
    // What the cashier tendered against, priced when the items were scanned.
    const previewTotal = total.value;
    if (
        offline.offline &&
        cartStore.attempt &&
        !(await offline.hasQueued(cartStore.attempt.idempotencyKey))
    )
        throw new Error(
            'This ticket may already be recorded online. Reconnect and retry it before using offline cash.',
        );
    const outcome = await checkout.submit(payment).catch(explainFailure);
    receipt.value = outcome.receipt;
    receiptNotice.value = offline.offline
        ? 'Offline cash sale — pending server sync. Keep this terminal and its browser data until all pending sales are confirmed.'
        : outcome.alreadyRecorded
          ? `This sale was already recorded with its original payment (${paymentLabel(outcome.receipt.paymentType)}). Settle change from this sale summary, not the amount just entered.`
          : outcome.receipt.totalAmount !== previewTotal
            ? PRICES_CHANGED_NOTICE
            : null;
    resetDiscountUi();
    dismissUndo();
    for (const product of Object.keys(qtyDrafts)) delete qtyDrafts[product];
    selectedLine.value = null;
    // The ticket is sold: back to it (an empty one) under the receipt.
    tender.hide();
    isReceiptOpen.value = true;
}

/** Rejects with the cashier-facing reason a sale failed. */
async function explainFailure(error: unknown): Promise<never> {
    let message = saleErrorMessage(error);
    // No open shift on the server (e.g. an admin force-closed it): nothing
    // was recorded. Drop the local shift; the layout then sends the
    // cashier to open a new one, with the ticket kept in the cart.
    if (apiErrorCode(error) === ErrorCode.SHIFT_NOT_OPEN) {
        shiftStore.shiftClosedElsewhere();
        throw new Error(message);
    }
    // A 400 means nothing was recorded. The usual cause is a price that
    // changed since the item was scanned, so the preview total the tenders
    // were built from is stale: refresh it for the retry.
    if (isRejectedSale(error) && (await refreshCartPrices())) {
        message += ' Prices have changed and the total is updated.';
    }
    throw new Error(message);
}

/** Re-reads each cart line's price; true if any changed. */
async function refreshCartPrices(): Promise<boolean> {
    try {
        const products = await Promise.all(
            cartStore.items.map(
                async (item) =>
                    (
                        await api.get<ProductView>(
                            `/products/${encodeURIComponent(item.EAN)}`,
                        )
                    ).data,
            ),
        );
        const changed = products.some(
            (p) =>
                cartStore.items.find((item) => item.product === p._id)
                    ?.unitPrice !== p.price,
        );
        cartStore.setUnitPrices(new Map(products.map((p) => [p._id, p.price])));
        return changed;
    } catch {
        return false;
    }
}

function onNewSale() {
    isReceiptOpen.value = false;
    receipt.value = null;
    receiptNotice.value = null;
    scanInput.value?.focus();
}

/**
 * The ticket is behind the tender sheet (below lg, #26): close it first,
 * so the focus can go to the scan box or a line.
 */
async function backToTicket() {
    if (!tender.isSheet.value) return;
    tender.hide();
    await nextTick();
}

/**
 * The register's keys (issues #22, #23). Off while a modal is open; the
 * checkout answers Enter and Escape itself. Delete removes the line the
 * focus is on (the line or one of its buttons), or the highlighted line
 * from the empty scan box (#85); in any field with text it edits the
 * text. A held Delete removes one line (its repeats are ignored).
 *
 * Below lg (#26) they also work while the tender sheet is on top (not
 * under a dialog): F2 and F4 close it and go to the ticket; F8 and F9
 * open it first when it is closed, then do what they do at lg (F9 then
 * opens the checkout over it). Delete does nothing in the sheet: no line
 * has the focus there.
 */
useRegisterShortcuts(
    {
        [REGISTER_KEYS.SCAN]: async () => {
            await backToTicket();
            scanInput.value?.focus();
            scanInput.value?.select();
        },
        [REGISTER_KEYS.DISCOUNT]: async () => {
            await tender.show();
            showDiscount.value = true;
            await nextTick();
            const options = [
                ...(discountOptionsEl.value?.querySelectorAll('button') ?? []),
            ];
            (
                options.find(
                    (b) => b.getAttribute('aria-pressed') === 'true',
                ) ?? options[0]
            )?.focus();
        },
        [REGISTER_KEYS.CHARGE]: async () => {
            if (canCheckout.value && !isTicketLocked.value) {
                await tender.show();
                openCheckout();
            } else if (needsReason.value) {
                await tender.show();
                void focusField(reasonInput);
            }
        },
        [REGISTER_KEYS.LINE_QUANTITY]: async () => {
            await backToTicket();
            focusLineQuantity();
        },
        [REGISTER_KEYS.REMOVE_LINE]: {
            run: removeSelected,
            // The scan box is a text field; deleteTarget decides. Not
            // mid-IME composition (the box reads empty then), and a held
            // key removes one line, not the ticket (#85).
            whileTyping: true,
            once: true,
            when: (event) => !event.isComposing && deleteTarget() !== null,
        },
    },
    { activeWhile: tender.isTop },
);

/**
 * A scan typed while the receipt was up (issue #22): the receipt closes,
 * the next sale starts, and the code goes through the scan box's own flow
 * as if it had been scanned there.
 */
function onReceiptScan(code: string) {
    onNewSale();
    searchQuery.value = code;
    void onScanSubmit();
}

onMounted(() => {
    scanInput.value?.focus();
});

onBeforeUnmount(() => {
    cancelPendingSearch();
    search.cancel();
    if (feedbackTimer) clearTimeout(feedbackTimer);
    dismissUndo();
});
</script>
