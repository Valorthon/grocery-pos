import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { isAxiosError } from 'axios';
import api from '@/axios';
import { requireOfflineConfirmation } from '@/offline/confirmation';
import { apiErrorCode, apiErrorText } from '@/utils/api-error';
import { newIdempotencyKey } from '@/components/User/Sales/sale-submission';
import {
    ErrorCode,
    PaymentType,
    Role,
    SaleStatus,
    TenderType,
    UnitOfMeasure,
    quantityAmount,
    type CurrentShiftView,
    type OfflineCatalogPage,
    type OfflineLeaseView,
    type OfflinePendingSale,
    type OfflineProduct,
    type ProductMatch,
    type ProductView,
    type Receipt,
    type SaleRequest,
} from '@grocery-pos/contracts';
import {
    activateOfflineLease,
    applyOfflinePage,
    blockOffline,
    getOrCreateOfflineState,
    pendingOffline,
    queuedOffline,
    queueOffline,
    readOfflineState,
    removeOffline,
    suspendOffline,
    type OfflineState,
} from '@/offline/database';
import type { CartItem } from './cart';

const networkFailure = (error: unknown) =>
    isAxiosError(error) && !error.response;
/** How long an availability probe may take before the API counts as down. */
export const PROBE_TIMEOUT_MS = 5000;
/** Proxy answers that mean the API behind it did not answer. */
const GATEWAY_DOWN = new Set([502, 503, 504]);
export const useOfflineStore = defineStore('offline', () => {
    const owner = ref<string | null>(null);
    const state = ref<OfflineState | null>(null);
    const pending = ref<OfflinePendingSale[]>([]);
    // Whether the configured API answers. The browser's online flag is
    // only a hint: a local API stays reachable without internet (#359).
    const connected = ref(true);
    const busy = ref(false);
    const error = ref('');
    const pendingOpen = ref(false);
    const admin = ref(false);
    let generation = 0;
    let syncing: Promise<void> | undefined;
    let preparing: Promise<void> | undefined;
    let probing: Promise<boolean> | undefined;
    const offline = computed(() => !connected.value);
    const ready = computed(
        () =>
            !!state.value?.lease &&
            state.value.products.length > 0 &&
            !state.value.suspended &&
            new Date(state.value.lease.expiresAt).getTime() > Date.now(),
    );
    async function refreshPending() {
        const gen = generation;
        const id = owner.value;
        const rows = await pendingOffline(
            admin.value ? undefined : (id ?? '__none__'),
        );
        if (gen === generation) pending.value = rows;
    }
    async function restore(
        id: string,
        roles: Role[],
    ): Promise<CurrentShiftView | null> {
        preparing = undefined;
        const gen = ++generation;
        owner.value = id;
        admin.value = roles.includes(Role.Admin);
        state.value = null;
        pending.value = [];
        error.value = '';
        try {
            const saved = await readOfflineState(id);
            if (gen !== generation) return null;
            state.value = saved ?? null;
            await refreshPending();
            return ready.value ? (state.value?.lease?.shift ?? null) : null;
        } catch (cause) {
            if (gen === generation) error.value = message(cause);
            return null;
        }
    }
    function reset() {
        generation++;
        preparing = undefined;
        busy.value = false;
        owner.value = null;
        state.value = null;
        pending.value = [];
        admin.value = false;
        pendingOpen.value = false;
        error.value = '';
    }
    function message(cause: unknown) {
        return apiErrorText(
            cause,
            cause instanceof Error
                ? cause.message
                : 'Offline storage is unavailable. Keep this terminal open and reconnect.',
        );
    }
    function prepare(shift: CurrentShiftView): Promise<void> {
        if (preparing) return preparing;
        const operation = prepareOnce(shift);
        preparing = operation;
        void operation.finally(() => {
            if (preparing === operation) preparing = undefined;
        });
        return operation;
    }
    async function prepareOnce(shift: CurrentShiftView): Promise<void> {
        if (!owner.value) return;
        const id = owner.value;
        const gen = generation;
        try {
            const previous = await getOrCreateOfflineState(
                id,
                newIdempotencyKey,
            );
            if (gen !== generation) return;
            if (previous?.suspended && previous.lease?.shift._id === shift._id)
                return;
            const terminalId = previous.terminalId;
            const lease = (
                await api.post<OfflineLeaseView>('/offline/lease', {
                    terminalId,
                })
            ).data;
            if (gen !== generation) return;
            const active = await activateOfflineLease(previous, lease);
            if (!active || gen !== generation) return;
            if (state.value?.lease?._id !== lease._id)
                state.value = { ...active, products: [] };
            let cursor = active.cursor;
            do {
                const page = (
                    await api.get<OfflineCatalogPage>('/offline/catalog', {
                        params: {
                            lease: lease._id,
                            ...(cursor ? { after: cursor } : {}),
                        },
                    })
                ).data;
                if (gen !== generation) return;
                if (!(await applyOfflinePage(id, lease._id, cursor, page)))
                    break;
                cursor = page.next;
            } while (cursor);
            const saved = await readOfflineState(id);
            if (!saved || saved.suspended || saved.lease?._id !== lease._id)
                return;
            if (gen !== generation) return;
            state.value = saved;
            connected.value = true;
            error.value = '';
            void navigator.storage?.persist?.().catch(() => false);
            await sync();
        } catch (cause) {
            if (gen !== generation) return;
            if (networkFailure(cause)) connected.value = false;
            error.value = message(cause);
        }
    }
    function cached(EAN: string): OfflineProduct {
        if (!ready.value)
            throw new Error(
                'Offline cash is not prepared or has expired. Reconnect before selling.',
            );
        const product = state.value?.products.find((p) => p.EAN === EAN);
        if (!product)
            throw new Error(
                'This product is not in the offline catalogue. Reconnect to sell it.',
            );
        return product;
    }
    async function product(EAN: string): Promise<ProductView> {
        if (connected.value) {
            try {
                return (
                    await api.get<ProductView>(
                        `/products/${encodeURIComponent(EAN)}`,
                    )
                ).data;
            } catch (cause) {
                if (!networkFailure(cause)) throw cause;
                connected.value = false;
            }
        }
        const p = cached(EAN);
        return {
            _id: p._id,
            EAN: p.EAN,
            name: p.name,
            price: p.price,
            unit: p.unit,
            createdAt: p.updatedAt,
            updatedAt: p.updatedAt,
        };
    }
    async function matches(term: string): Promise<ProductMatch[]> {
        if (connected.value) {
            try {
                return (
                    await api.get<ProductMatch[]>('/products/matches', {
                        params: { name: term },
                    })
                ).data;
            } catch (cause) {
                if (!networkFailure(cause)) throw cause;
                connected.value = false;
            }
        }
        if (!ready.value) return [];
        const query = term.toLocaleLowerCase();
        return (state.value?.products ?? [])
            .filter(
                (p) =>
                    p.name.toLocaleLowerCase().includes(query) ||
                    p.EAN.startsWith(term),
            )
            .slice(0, 10)
            .map((p) => ({
                product: p._id,
                name: p.name,
                EAN: p.EAN,
                unit: p.unit,
            }));
    }
    async function hasQueued(key: string): Promise<boolean> {
        const id = owner.value;
        return id !== null && !!(await queuedOffline(id, key));
    }
    async function queue(
        body: SaleRequest,
        items: readonly CartItem[],
    ): Promise<Receipt> {
        const gen = generation;
        const id = owner.value;
        if (!id) throw new Error('Log in again before selling.');
        const existing = await queuedOffline(id, body.idempotencyKey);
        if (existing) {
            if (gen !== generation)
                throw new Error(
                    'The cashier changed; the original pending sale is kept.',
                );
            return existing.receipt;
        }
        if (
            body.paymentType !== PaymentType.CASH ||
            body.discount ||
            body.tenders.length !== 1 ||
            body.tenders[0]?.type !== TenderType.CASH
        )
            throw new Error(
                'Offline sales allow cash only, without discounts, overrides or GCash.',
            );
        const saved = await readOfflineState(id);
        if (!saved?.lease || saved.suspended || saved.lease.cashier !== id)
            throw new Error(
                'Offline cash is not prepared. Reconnect before collecting cash.',
            );
        const lines = body.sellDetails.map((line) => {
            const item = items.find((i) => i.product === line.product);
            const p = saved.products.find((p) => p._id === line.product);
            if (
                !p ||
                !item ||
                p.price !== item.unitPrice ||
                p.unit !== (item.unit ?? UnitOfMeasure.PIECE)
            )
                throw new Error(
                    'Cached prices changed or an item is unavailable offline. Reconnect and refresh the ticket before collecting cash.',
                );
            return {
                product: line.product,
                quantity: line.quantity,
                proof: p.proof,
                p,
            };
        });
        const subtotal = lines.reduce(
            (sum, line) =>
                sum + quantityAmount(line.p.price, line.quantity, line.p.unit),
            0,
        );
        const tendered = body.tenders[0].amount;
        if (tendered < subtotal)
            throw new Error('Cash tender does not cover the cached total.');
        const soldAt = new Date().toISOString();
        const receipt: Receipt = {
            ...(saved.lease.storeIdentity
                ? { storeIdentity: saved.lease.storeIdentity }
                : {}),
            _id: body.idempotencyKey,
            createdAt: soldAt,
            status: SaleStatus.COMPLETED,
            paymentType: PaymentType.CASH,
            referenceNumber: null,
            tenders: body.tenders,
            amountTendered: tendered,
            changeGiven: tendered - subtotal,
            cashierName: saved.lease.cashierName,
            items: lines.map((line) => ({
                productName: line.p.name,
                quantity: line.quantity,
                unitPrice: line.p.price,
                unit: line.p.unit,
                amount: quantityAmount(
                    line.p.price,
                    line.quantity,
                    line.p.unit,
                ),
            })),
            subtotal,
            discount: null,
            totalAmount: subtotal,
        };
        const entry = await queueOffline({
            owner: id,
            request: {
                lease: saved.lease._id,
                idempotencyKey: body.idempotencyKey,
                soldAt,
                amountTendered: tendered,
                lines: lines.map(({ product, quantity, proof }) => ({
                    product,
                    quantity,
                    proof,
                })),
            },
            receipt,
        });
        if (gen !== generation)
            throw new Error(
                'The cashier changed. The collected cash sale remains safely queued for its original cashier.',
            );
        await refreshPending();
        return entry.receipt;
    }
    async function sync(): Promise<void> {
        if (syncing) return syncing;
        if (!owner.value || !connected.value) return;
        const id = owner.value;
        const gen = generation;
        syncing = (async () => {
            busy.value = true;
            try {
                for (const entry of await pendingOffline(id)) {
                    if (gen !== generation || entry.blocked) continue;
                    try {
                        const confirmed = await api.post<Receipt>(
                            '/offline/sync',
                            entry.request,
                        );
                        requireOfflineConfirmation(entry, confirmed.data);
                        await removeOffline(entry);
                    } catch (cause) {
                        if (gen !== generation) break;
                        if (networkFailure(cause)) {
                            connected.value = false;
                            break;
                        }
                        const code = apiErrorCode(cause);
                        if (
                            code ===
                                ErrorCode.OFFLINE_RECONCILIATION_REQUIRED ||
                            code === ErrorCode.OFFLINE_INVALID ||
                            code === ErrorCode.SALE_IDEMPOTENCY_MISMATCH ||
                            (isAxiosError(cause) &&
                                [400, 401, 403].includes(
                                    cause.response?.status ?? 0,
                                ))
                        )
                            await blockOffline(entry, message(cause));
                        error.value = message(cause);
                    }
                }
            } finally {
                if (gen === generation) {
                    busy.value = false;
                    await refreshPending();
                }
                syncing = undefined;
            }
        })();
        return syncing;
    }
    async function reconcileEntry(
        entry: OfflinePendingSale,
        reason: string,
    ): Promise<void> {
        if (!admin.value || !reason.trim())
            throw new Error('An admin reconciliation reason is required.');
        const confirmed = await api.post<Receipt>('/offline/reconcile', {
            ...entry.request,
            reason: reason.trim(),
        });
        requireOfflineConfirmation(entry, confirmed.data);
        await removeOffline(entry);
        await refreshPending();
    }
    async function beforeClose(): Promise<void> {
        if (!owner.value || !state.value?.lease) return;
        const id = owner.value;
        if (!(await probe()))
            throw new Error(
                'Reconnect and sync pending cash sales before closing this shift.',
            );
        await sync();
        const saved = await suspendOffline(id);
        if (saved?.lease) {
            await api.post(`/offline/leases/${saved.lease._id}/release`, {
                terminalId: saved.terminalId,
            });
            if (owner.value === id)
                state.value = {
                    ...saved,
                    products:
                        state.value?.lease?._id === saved.lease._id
                            ? state.value.products
                            : [],
                    suspended: true,
                };
        }
    }
    /**
     * Asks the configured API (never an external service) whether it
     * answers, once at a time and bounded by PROBE_TIMEOUT_MS. Any answer
     * from the API counts as reachable, even an unhealthy one; no answer,
     * a timeout or a proxy's gateway error counts as unreachable. A probe
     * that outlives a logout or cashier change writes nothing.
     */
    function probe(): Promise<boolean> {
        if (probing) return probing;
        const gen = generation;
        const operation = api
            .get('/health/live', { timeout: PROBE_TIMEOUT_MS })
            .then(
                () => true,
                (cause: unknown) =>
                    isAxiosError(cause) &&
                    !!cause.response &&
                    !GATEWAY_DOWN.has(cause.response.status),
            )
            .then((reachable) => {
                if (gen === generation) connected.value = reachable;
                return reachable;
            })
            .finally(() => {
                if (probing === operation) probing = undefined;
            });
        probing = operation;
        return operation;
    }
    function setConnection(value: boolean) {
        connected.value = value;
    }
    return {
        owner,
        state,
        pending,
        connected,
        offline,
        ready,
        busy,
        error,
        pendingOpen,
        admin,
        restore,
        reset,
        refreshPending,
        prepare,
        product,
        matches,
        hasQueued,
        queue,
        sync,
        reconcileEntry,
        beforeClose,
        probe,
        setConnection,
    };
});
