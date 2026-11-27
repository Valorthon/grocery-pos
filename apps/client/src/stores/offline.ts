import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { isAxiosError } from 'axios';
import api from '@/axios';
import { hasSavedTerminalLabel, terminalLabel } from '@/settings/presentation';
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
    offlineClockOffset,
    offlineSoldAtMs,
    OFFLINE_CLOCK_WARN_MS,
    type CurrentShiftView,
    type OfflineCatalogPage,
    type OfflineLeaseRequest,
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

/** The signed `iat` (whole seconds) of a cached price proof, if readable. */
export function proofIat(proof: string): number | undefined {
    try {
        const part = proof.split('.')[1] ?? '';
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
        const iat = (JSON.parse(json) as { iat?: unknown }).iat;
        return Number.isSafeInteger(iat) ? (iat as number) : undefined;
    } catch {
        return undefined;
    }
}
/** Runs a request and measures the clock offset from its `serverTime` (#398). */
async function timed<T extends { serverTime: number }>(
    request: () => Promise<{ data: T }>,
): Promise<{ data: T; offset?: number }> {
    const sentAt = Date.now();
    const { data } = await request();
    const offset = offlineClockOffset(sentAt, Date.now(), data.serverTime);
    return Number.isFinite(offset) ? { data, offset } : { data };
}
const networkFailure = (error: unknown) =>
    isAxiosError(error) && !error.response;
/** How long an availability probe may take before the API counts as down. */
export const PROBE_TIMEOUT_MS = 5000;

/**
 * Whether a refused upload needs admin review (it stays stored, marked
 * blocked) rather than a later retry. A stale tab after an upgrade
 * (409 CLIENT_OUTDATED, #364) is a retry: the receipt stays queued and
 * the reloaded page uploads it.
 */
export function offlineRefusalBlocks(
    code: ErrorCode | undefined,
    status: number,
): boolean {
    if (code === ErrorCode.CLIENT_OUTDATED) return false;
    return (
        code === ErrorCode.OFFLINE_RECONCILIATION_REQUIRED ||
        code === ErrorCode.OFFLINE_INVALID ||
        code === ErrorCode.SALE_IDEMPOTENCY_MISMATCH ||
        [400, 401, 403].includes(status)
    );
}
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
    // Bumped by every connection verdict, so an older probe can't undo it.
    let verdict = 0;
    const offline = computed(() => !connected.value);
    /** Server minus terminal clock (ms); 0 until a lease answer was seen. */
    const clockOffset = computed(() => state.value?.clockOffset ?? 0);
    /**
     * Whether this page measured the offset itself. A stored offset still
     * corrects time after a reload, but only a fresh measurement may warn,
     * so a fixed clock doesn't keep its old warning (#505).
     */
    const clockMeasured = ref(false);
    /** The terminal clock is far enough off to need fixing (#398). */
    const clockWarning = computed(
        () =>
            clockMeasured.value &&
            Math.abs(clockOffset.value) > OFFLINE_CLOCK_WARN_MS,
    );
    const now = () => Date.now() + clockOffset.value;
    const ready = computed(
        () =>
            !!state.value?.lease &&
            state.value.products.length > 0 &&
            !state.value.suspended &&
            new Date(state.value.lease.expiresAt).getTime() > now(),
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
        probing = undefined;
        const gen = ++generation;
        owner.value = id;
        admin.value = roles.includes(Role.Admin);
        state.value = null;
        clockMeasured.value = false;
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
        probing = undefined;
        busy.value = false;
        owner.value = null;
        state.value = null;
        clockMeasured.value = false;
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
        // A shift bound to another terminal gets no lease here (#509).
        if (!owner.value || shift.onThisTerminal === false) return;
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
            const { data: lease, offset } = await timed(() =>
                api.post<OfflineLeaseView>('/offline/lease', {
                    terminalId,
                    // The saved label names this terminal if it blocks a
                    // shift close (#454); the default label isn't sent.
                    ...(hasSavedTerminalLabel()
                        ? { terminalLabel: terminalLabel.value }
                        : {}),
                } satisfies OfflineLeaseRequest),
            );
            if (gen !== generation) return;
            const active = await activateOfflineLease(previous, lease, offset);
            if (!active || gen !== generation) return;
            if (state.value?.lease?._id !== lease._id)
                state.value = { ...active, products: [] };
            else if (offset !== undefined)
                // Show the fresh offset now, not after the catalogue (#505).
                state.value = { ...active, products: state.value.products };
            if (offset !== undefined) clockMeasured.value = true;
            let cursor = active.cursor;
            do {
                const { data: page, offset: pageOffset } = await timed(() =>
                    api.get<OfflineCatalogPage>('/offline/catalog', {
                        params: {
                            lease: lease._id,
                            ...(cursor ? { after: cursor } : {}),
                        },
                    }),
                );
                if (gen !== generation) return;
                if (
                    !(await applyOfflinePage(
                        id,
                        lease._id,
                        cursor,
                        page,
                        pageOffset,
                    ))
                )
                    break;
                if (pageOffset !== undefined) clockMeasured.value = true;
                cursor = page.next;
            } while (cursor);
            const saved = await readOfflineState(id);
            if (!saved || saved.suspended || saved.lease?._id !== lease._id)
                return;
            if (gen !== generation) return;
            state.value = saved;
            setConnection(true);
            error.value = '';
            void navigator.storage?.persist?.().catch(() => false);
            await sync();
        } catch (cause) {
            if (gen !== generation) return;
            if (networkFailure(cause)) setConnection(false);
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
                setConnection(false);
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
                setConnection(false);
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
        // Corrected terminal clock, clamped so a residual offset can't put
        // the sale before its lease or a price proof (#398).
        const soldAt = new Date(
            offlineSoldAtMs(
                Date.now() + (saved.clockOffset ?? 0),
                saved.lease.issuedAt,
                lines.flatMap((line) => proofIat(line.proof) ?? []),
            ),
        ).toISOString();
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
                            setConnection(false);
                            break;
                        }
                        if (
                            offlineRefusalBlocks(
                                apiErrorCode(cause),
                                isAxiosError(cause)
                                    ? (cause.response?.status ?? 0)
                                    : 0,
                            )
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
        // A focus-triggered prepare still running must not renew the lease
        // after its release (#505).
        await preparing?.catch(() => undefined);
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
     * answers, once at a time and bounded by PROBE_TIMEOUT_MS. The API
     * process answered when the response carries its X-Request-Id, even an
     * unhealthy 503 from its own health check; no response, a timeout or a
     * 5xx without that header (a proxy) counts as unreachable. A probe that
     * outlives a logout or cashier change, or a newer verdict, writes
     * nothing.
     */
    function probe(): Promise<boolean> {
        if (probing) return probing;
        const gen = generation;
        const seen = verdict;
        // Started inside a promise, so a synchronous throw is a failed probe.
        const operation = Promise.resolve()
            .then(() => api.get('/health/live', { timeout: PROBE_TIMEOUT_MS }))
            .then(
                () => true,
                (cause: unknown) => {
                    if (!isAxiosError(cause) || !cause.response) return false;
                    const { status, headers } = cause.response;
                    return (
                        status < 500 ||
                        !!(headers as Record<string, unknown>)['x-request-id']
                    );
                },
            )
            .then((reachable) => {
                if (gen === generation && seen === verdict)
                    setConnection(reachable);
                return reachable;
            })
            .finally(() => {
                if (probing === operation) probing = undefined;
            });
        probing = operation;
        return operation;
    }
    function setConnection(value: boolean) {
        verdict++;
        connected.value = value;
    }
    return {
        owner,
        state,
        pending,
        connected,
        offline,
        ready,
        clockOffset,
        clockMeasured,
        clockWarning,
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
