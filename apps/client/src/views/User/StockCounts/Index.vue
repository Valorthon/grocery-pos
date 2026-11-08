<template>
    <PageFrame>
        <PageCard>
            <div class="space-y-4 p-5">
                <p v-if="error" role="alert" class="text-red-700">
                    {{ error }}
                    <BaseButton :disabled="busy" @click="retry"
                        >Reload</BaseButton
                    >
                </p>
                <p v-if="validation" role="alert" class="text-red-700">
                    {{ validation }}
                </p>
                <template v-if="!selected">
                    <form
                        class="flex flex-wrap items-end gap-3"
                        @submit.prevent="create"
                    >
                        <label class="text-sm"
                            >Count scope<select
                                v-model="scope"
                                class="block min-h-11 rounded border p-2"
                                :disabled="busy"
                            >
                                <option value="all">All active products</option>
                                <option value="category">Category</option>
                                <option value="products">
                                    Picked barcodes
                                </option>
                            </select></label
                        >
                        <label v-if="scope === 'category'" class="text-sm"
                            >Category<select
                                v-model="category"
                                class="block min-h-11 rounded border p-2"
                                :disabled="busy"
                            >
                                <option value="">Choose category</option>
                                <option
                                    v-for="row in categories"
                                    :key="row._id"
                                    :value="row._id"
                                >
                                    {{ row.name }}
                                </option>
                            </select></label
                        >
                        <BaseInput
                            v-if="scope === 'products'"
                            v-model="pickedCodes"
                            label="Barcodes (comma or space separated)"
                            :disabled="busy"
                        />
                        <BaseButton type="submit" :disabled="busy"
                            >Start count</BaseButton
                        >
                    </form>
                    <p v-if="categoryError" role="alert">
                        {{ categoryError }}
                        <BaseButton @click="refreshCategories"
                            >Retry categories</BaseButton
                        >
                    </p>
                    <p class="text-sm text-slate-600">
                        Count at the opening reference time. Sales, deliveries,
                        returns and adjustments after that reference are
                        preserved when approved. If your shelf count already
                        includes those movements, start a fresh count at a quiet
                        reference point.
                    </p>
                    <p v-if="busy">Loading…</p>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead>
                                <tr>
                                    <th class="text-left">Opened</th>
                                    <th>Status</th>
                                    <th>Lines</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in rows"
                                    :key="row._id"
                                    class="border-t"
                                >
                                    <td>
                                        {{ formatStoreDateTime(row.createdAt) }}
                                    </td>
                                    <td>{{ row.status }}</td>
                                    <td>{{ row.lines.length }}</td>
                                    <td>
                                        <BaseButton
                                            :disabled="busy"
                                            @click="load(row._id)"
                                            >Open count</BaseButton
                                        >
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="flex items-center gap-3">
                        <BaseButton
                            :disabled="busy || page === 1"
                            @click="changePage(-1)"
                            >Previous</BaseButton
                        ><span>Page {{ page }}</span
                        ><BaseButton
                            :disabled="busy || page * 20 >= total"
                            @click="changePage(1)"
                            >Next</BaseButton
                        >
                    </div>
                </template>
                <template v-else>
                    <div class="flex flex-wrap items-center gap-3">
                        <BaseButton
                            :disabled="busy"
                            variant="outline"
                            @click="back"
                            >Back to counts</BaseButton
                        ><strong>{{ selected.status }}</strong
                        ><span class="text-sm"
                            >Reference:
                            {{ formatStoreDateTime(selected.createdAt) }}</span
                        >
                    </div>
                    <p class="text-sm text-slate-600">
                        The adjustment is counted quantity minus opening
                        expected quantity. Later stock movements remain. Blank
                        means not counted; enter 0 explicitly for an empty
                        shelf. Tracked products are counted by batch; this does
                        not invent expiry dates or new lots.
                    </p>
                    <BaseInput
                        v-if="selected.status === StockCountStatus.OPEN"
                        v-model="scan"
                        label="Scan barcode to focus its count"
                        @keydown.enter.prevent="focusBarcode"
                    />
                    <div class="overflow-x-auto">
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm">
                                <thead>
                                    <tr>
                                        <th class="text-left">
                                            Product / batch
                                        </th>
                                        <th>Opening</th>
                                        <th>Current</th>
                                        <th>Counted</th>
                                        <th>Variance</th>
                                        <th
                                            v-if="
                                                selected.status ===
                                                StockCountStatus.SUBMITTED
                                            "
                                        >
                                            Projected balance
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr
                                        v-for="line in selected.lines"
                                        :key="line._id"
                                        class="border-t"
                                        :class="{
                                            'bg-amber-50':
                                                displayedVariance(line) !==
                                                    null &&
                                                displayedVariance(line) !== 0,
                                        }"
                                    >
                                        <td class="py-2">
                                            {{ line.name }}<br /><span
                                                class="text-xs text-slate-500"
                                                >{{ line.EAN
                                                }}<template
                                                    v-if="line.tracksExpiry"
                                                >
                                                    ·
                                                    {{
                                                        line.batchNo ||
                                                        'Unnumbered batch'
                                                    }}
                                                    ·
                                                    {{
                                                        line.expiryDate ||
                                                        'Reconciliation / no expiry'
                                                    }}</template
                                                ></span
                                            >
                                        </td>
                                        <td>
                                            {{
                                                formatQuantity(
                                                    line.expectedQty,
                                                    line.unit,
                                                )
                                            }}
                                        </td>
                                        <td>
                                            {{
                                                line.currentQty === undefined
                                                    ? '—'
                                                    : formatQuantity(
                                                          line.currentQty,
                                                          line.unit,
                                                      )
                                            }}
                                        </td>
                                        <td>
                                            <input
                                                v-if="
                                                    selected.status ===
                                                    StockCountStatus.OPEN
                                                "
                                                :id="`count-${line._id}`"
                                                v-model="entries[line._id]"
                                                class="min-h-11 w-28 rounded border p-2"
                                                :aria-label="`Count ${line.name} ${line.batchNo || line._id}`"
                                                inputmode="decimal"
                                                :disabled="busy"
                                                @input="dirty = true"
                                            /><span v-else>{{
                                                line.countedQty === undefined
                                                    ? 'Not counted'
                                                    : formatQuantity(
                                                          line.countedQty,
                                                          line.unit,
                                                      )
                                            }}</span>
                                        </td>
                                        <td>
                                            {{
                                                displayedVariance(line) === null
                                                    ? 'Not counted'
                                                    : formatQuantity(
                                                          displayedVariance(
                                                              line,
                                                          )!,
                                                          line.unit,
                                                      )
                                            }}
                                        </td>
                                        <td
                                            v-if="
                                                selected.status ===
                                                StockCountStatus.SUBMITTED
                                            "
                                        >
                                            {{ projected(line) }}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-3">
                        <BaseButton
                            v-if="selected.status === StockCountStatus.OPEN"
                            :disabled="busy"
                            @click="save"
                            >Save progress</BaseButton
                        >
                        <BaseButton
                            v-if="selected.status === StockCountStatus.OPEN"
                            :disabled="busy"
                            @click="submit"
                            >Submit for approval</BaseButton
                        >
                        <BaseButton
                            v-if="
                                selected.status === StockCountStatus.SUBMITTED
                            "
                            :disabled="busy"
                            @click="approve"
                            >Manager approval and post</BaseButton
                        >
                        <BaseButton
                            v-if="
                                selected.status === StockCountStatus.OPEN ||
                                selected.status === StockCountStatus.SUBMITTED
                            "
                            variant="outline"
                            :disabled="busy"
                            @click="cancel"
                            >Cancel count</BaseButton
                        >
                        <a
                            v-if="selected.adjustment"
                            href="/admin/adjustments"
                            class="min-h-11 p-2 text-teal-800 underline"
                            >View adjustment history</a
                        >
                    </div>
                </template>
            </div>
            <ConfirmDialog :request="request" @answer="answer" />
            <ManagerOverrideDialog
                :model-value="isApprovalOpen"
                :request="approvalRequest"
                :summary="approvalSummary"
                note="You stay logged in; the approval applies to this count only."
                @approved="completeApproval"
                @cancel="cancelApproval"
                @update:model-value="(open) => !open && cancelApproval()"
            />
        </PageCard>
    </PageFrame>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import {
    ErrorCode,
    OverrideAction,
    STOCK_COUNT_LINE_MAX,
    StockCountStatus,
    formatQuantity,
    parseQuantity,
    quantityInput,
    type CreateStockCountRequest,
    type Paginated,
    type ProductView,
    type SaveStockCountRequest,
    type StockCountLineView,
    type StockCountView,
} from '@grocery-pos/contracts';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import ManagerOverrideDialog from '@/components/User/Sales/ManagerOverrideDialog.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useManagerApproval } from '@/composables/useManagerApproval';
import { useCategories } from '@/composables/useCategories';
import { apiErrorCode, apiErrorText } from '@/utils/api-error';
import { formatStoreDateTime } from '@/utils/datetime';
import { Color, useUIStore } from '@/stores/ui';
import { useAuthStore } from '@/stores/auth';
import { watch } from 'vue';
const router = useRouter();
const auth = useAuthStore();
const {
    categories,
    error: categoryError,
    refresh: refreshCategories,
} = useCategories();
const { request, answer, confirm } = useConfirm();
const uiStore = useUIStore();
const {
    isApprovalOpen,
    approvalRequest,
    approvalSummary,
    requestApproval,
    completeApproval,
    cancelApproval,
} = useManagerApproval();
const rows = ref<StockCountView[]>([]),
    selected = ref<StockCountView | null>(null),
    entries = ref<Record<string, string>>({});
const page = ref(1),
    total = ref(0),
    busy = ref(false),
    dirty = ref(false),
    error = ref(''),
    validation = ref('');
const scope = ref<CreateStockCountRequest['scope']>('all'),
    category = ref(''),
    pickedCodes = ref(''),
    scan = ref('');
let generation = 0;
function live(turn: number, owner: string | undefined) {
    return turn === generation && auth.user?.userId === owner;
}
watch(
    () => auth.user?.userId,
    () => {
        generation++;
        selected.value = null;
        rows.value = [];
        entries.value = {};
        dirty.value = false;
        busy.value = false;
        cancelApproval();
    },
);
function accept(count: StockCountView) {
    selected.value = count;
    entries.value = Object.fromEntries(
        count.lines.map((line) => [
            line._id,
            line.countedQty === undefined
                ? ''
                : quantityInput(line.countedQty, line.unit),
        ]),
    );
    dirty.value = false;
    validation.value = '';
}
/**
 * Runs one request. A failed load is an inline error with Reload; a failed
 * user action is an error toast, except a version conflict, which also
 * offers Reload because the count changed on the server.
 */
async function run(
    action: (turn: number, owner: string | undefined) => Promise<void>,
    kind: 'load' | 'action' = 'action',
) {
    if (busy.value) return;
    const turn = ++generation,
        owner = auth.user?.userId;
    busy.value = true;
    error.value = '';
    validation.value = '';
    try {
        await action(turn, owner);
    } catch (cause) {
        if (!live(turn, owner)) return;
        const text = apiErrorText(cause, 'Stock count could not be updated.');
        if (kind === 'action') uiStore.queueMessage(Color.ERROR, text);
        if (kind === 'load' || apiErrorCode(cause) === ErrorCode.CONFLICT)
            error.value = text;
    } finally {
        if (live(turn, owner)) busy.value = false;
    }
}
async function refresh() {
    await run(async (turn, owner) => {
        const { data } = await api.get<Paginated<StockCountView>>(
            '/stock-counts',
            { params: { page: page.value, limit: 20 } },
        );
        if (live(turn, owner)) {
            rows.value = data.data;
            total.value = data.totalItems;
        }
    }, 'load');
}
async function load(id: string) {
    await run(async (turn, owner) => {
        const { data } = await api.get<StockCountView>(`/stock-counts/${id}`);
        if (live(turn, owner)) accept(data);
    }, 'load');
}
async function retry() {
    if (busy.value) return;
    if (selected.value) {
        if (!(await discardLocal())) return;
        await load(selected.value._id);
    } else await refresh();
}
async function changePage(change: number) {
    page.value += change;
    await refresh();
}
async function create() {
    await run(async (turn, owner) => {
        const body: CreateStockCountRequest = { scope: scope.value };
        if (scope.value === 'category') {
            if (!category.value) {
                validation.value = 'Choose a category.';
                return;
            }
            body.category = category.value;
        }
        if (scope.value === 'products') {
            const codes = [
                ...new Set(pickedCodes.value.split(/[\s,]+/).filter(Boolean)),
            ];
            if (!codes.length || codes.length > STOCK_COUNT_LINE_MAX) {
                validation.value = `Choose 1–${STOCK_COUNT_LINE_MAX} distinct barcodes.`;
                return;
            }
            const products: string[] = [];
            for (const EAN of codes) {
                const { data } = await api.get<ProductView>(
                    `/products/${encodeURIComponent(EAN)}`,
                );
                if (!live(turn, owner)) return;
                products.push(data._id);
            }
            body.products = products;
        }
        const { data } = await api.post<StockCountView>('/stock-counts', body);
        if (live(turn, owner)) accept(data);
    });
}
function patches(): SaveStockCountRequest | null {
    if (!selected.value) return null;
    const lines: SaveStockCountRequest['lines'] = [];
    for (const line of selected.value.lines) {
        const text = entries.value[line._id] ?? '';
        if (!text.trim()) {
            if (line.countedQty !== undefined) {
                validation.value =
                    'Previously saved quantities cannot be cleared; enter a count or cancel and restart.';
                return null;
            }
            continue;
        }
        const qty = parseQuantity(text, line.unit);
        if (
            qty === null ||
            qty < 0 ||
            !Number.isSafeInteger(qty - line.expectedQty)
        ) {
            validation.value = `Enter a valid nonnegative count for ${line.name} in its unit.`;
            return null;
        }
        if (qty !== line.countedQty)
            lines.push({ line: line._id, countedQty: qty });
    }
    return { version: selected.value.version, lines };
}
async function persist(
    turn: number,
    owner: string | undefined,
): Promise<boolean> {
    const body = patches();
    if (!body || !selected.value) return false;
    if (!body.lines.length) {
        dirty.value = false;
        return true;
    }
    const { data } = await api.patch<StockCountView>(
        `/stock-counts/${selected.value._id}`,
        body,
    );
    if (!live(turn, owner)) return false;
    accept(data);
    return true;
}
async function save() {
    await run(async (turn, owner) => {
        const before = selected.value?.version;
        if ((await persist(turn, owner)) && selected.value?.version !== before)
            uiStore.queueMessage(Color.SUCCESS, 'Count progress saved.');
    });
}
function lineLabel(line: StockCountLineView): string {
    if (!line.tracksExpiry) return line.name;
    if (line.batchNo) return `${line.name} (batch ${line.batchNo})`;
    return line.expiryDate
        ? `${line.name} (expires ${line.expiryDate})`
        : `${line.name} (no expiry)`;
}
function uncountedLines(): StockCountLineView[] {
    return (selected.value?.lines ?? []).filter(
        (line) => !(entries.value[line._id] ?? '').trim(),
    );
}
async function submit() {
    if (!selected.value) return;
    const blank = uncountedLines();
    if (blank.length) {
        const names = blank.slice(0, 3).map(lineLabel);
        validation.value = `Count every line before submitting (enter 0 for none). Uncounted: ${names.join(', ')}${blank.length > 3 ? ` and ${blank.length - 3} more` : ''}.`;
        document.getElementById(`count-${blank[0]._id}`)?.focus();
        return;
    }
    if (
        !(await confirm({
            title: 'Submit stock count?',
            message:
                'Every line is counted. Submission freezes these quantities for manager approval.',
            confirmLabel: 'Submit count',
        }))
    )
        return;
    await run(async (turn, owner) => {
        if (!(await persist(turn, owner)) || !selected.value) return;
        const { data } = await api.post<StockCountView>(
            `/stock-counts/${selected.value._id}/submit`,
            { version: selected.value.version },
        );
        if (live(turn, owner)) accept(data);
    });
}
async function cancel() {
    if (
        !selected.value ||
        !(await confirm({
            title: 'Cancel stock count?',
            message:
                'This count will remain in history and will not change stock.',
            confirmLabel: 'Cancel count',
        }))
    )
        return;
    await run(async (turn, owner) => {
        if (!selected.value) return;
        const { data } = await api.post<StockCountView>(
            `/stock-counts/${selected.value._id}/cancel`,
            { version: selected.value.version },
        );
        if (live(turn, owner)) accept(data);
    });
}
async function approve() {
    if (!selected.value || busy.value) return;
    const id = selected.value._id,
        version = selected.value.version,
        owner = auth.user?.userId,
        turn = generation;
    const token = await requestApproval(
        {
            action: OverrideAction.STOCK_COUNT,
            context: { stockCount: { countId: id, version } },
        },
        'Approve these exact stock-count variances. Later stock movements remain; a change that would make stock negative is refused.',
    );
    if (
        !token ||
        !live(turn, owner) ||
        selected.value?._id !== id ||
        selected.value.version !== version
    )
        return;
    await run(async (saveTurn, saveOwner) => {
        const { data } = await api.post<StockCountView>(
            `/stock-counts/${id}/approve`,
            { version },
            { headers: { 'X-Manager-Approval': token } },
        );
        if (live(saveTurn, saveOwner)) accept(data);
    });
}
function displayedVariance(line: StockCountLineView): number | null {
    const qty =
        selected.value?.status === StockCountStatus.OPEN
            ? parseQuantity(entries.value[line._id] ?? '', line.unit)
            : line.countedQty;
    return qty === null ||
        qty === undefined ||
        !Number.isSafeInteger(qty - line.expectedQty)
        ? null
        : qty - line.expectedQty;
}
function projected(line: StockCountLineView): string {
    if (line.countedQty === undefined || line.currentQty === undefined)
        return '—';
    const balance = line.currentQty + (line.countedQty - line.expectedQty);
    return Number.isSafeInteger(balance)
        ? formatQuantity(balance, line.unit)
        : 'Outside limits';
}
function focusBarcode() {
    const code = scan.value.trim();
    const line = selected.value?.lines.find((row) => row.EAN === code);
    if (line) document.getElementById(`count-${line._id}`)?.focus();
    else validation.value = 'Barcode is not in this count scope.';
    scan.value = '';
}
async function discardLocal(): Promise<boolean> {
    return (
        !dirty.value ||
        (await confirm({
            title: 'Leave unsaved counts?',
            message:
                'Saved progress stays on the server; unsaved entries will be discarded.',
            confirmLabel: 'Discard unsaved entries',
            cancelLabel: 'Stay',
        }))
    );
}
async function back() {
    if (busy.value || !(await discardLocal())) return;
    selected.value = null;
    dirty.value = false;
    await refresh();
}
onBeforeRouteLeave(
    async () =>
        !auth.isAuthenticated ||
        (!busy.value && !isApprovalOpen.value && (await discardLocal())),
);
const unload = (event: BeforeUnloadEvent) => {
    if (dirty.value || busy.value) {
        event.preventDefault();
        event.returnValue = '';
    }
};
onMounted(() => {
    window.addEventListener('beforeunload', unload);
    const source = router.currentRoute?.value.query.source;
    if (typeof source === 'string' && /^[a-f0-9]{24}$/i.test(source))
        void load(source);
    else void refresh();
});
onBeforeUnmount(() => {
    generation++;
    window.removeEventListener('beforeunload', unload);
    cancelApproval();
});
</script>
