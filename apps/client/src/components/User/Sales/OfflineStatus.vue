<template>
    <div
        v-if="
            status.offline ||
            status.ready ||
            status.pending.length ||
            status.error ||
            status.clockWarning
        "
        class="shrink-0 px-3 py-2 bg-amber-50 border-b border-amber-200 text-sm flex flex-wrap items-center gap-2"
        role="status"
        data-testid="offline-status"
    >
        <span class="font-bold"
            >{{
                status.offline
                    ? 'Offline — cash only'
                    : status.ready
                      ? 'Offline cash ready'
                      : 'Offline cash sync'
            }}
            · {{ status.pending.length }} sales pending</span
        >
        <span v-if="terminal" class="text-xs" data-testid="offline-terminal-id"
            >Terminal {{ terminal }}</span
        >
        <span v-if="status.offline">{{
            status.ready
                ? 'Cached prices; no discounts, GCash, voids or refunds.'
                : 'Offline cash is not prepared. Reconnect before selling.'
        }}</span>
        <span
            v-if="status.clockWarning"
            class="text-red-800"
            data-testid="offline-clock-warning"
            >This terminal's clock is {{ clockDrift }} off the main PC. Ask the
            owner to fix its time setting.</span
        >
        <span v-if="status.error" class="text-red-800">{{ status.error }}</span>
        <button
            v-if="status.pending.length"
            type="button"
            class="min-h-11 px-3 font-bold underline"
            @click="status.pendingOpen = true"
        >
            Review pending sales
        </button>
        <button
            v-if="!status.offline && status.pending.length"
            type="button"
            class="min-h-11 px-3 font-bold underline"
            :disabled="status.busy"
            @click="retry"
        >
            Sync now
        </button>
    </div>
    <BaseModal
        v-model="status.pendingOpen"
        :error="failure"
        error-testid="offline-pending-error"
        title="Pending offline cash sales"
        max-width="40rem"
        scrollable
    >
        <p class="text-sm mb-3">
            These sales already collected cash. They remain saved until the
            server confirms them. Do not charge the customer again.
        </p>
        <p v-if="!status.pending.length" class="text-sm">No pending sales.</p>
        <div
            v-for="entry in status.pending"
            :key="entry.request.idempotencyKey"
            class="border rounded-xl p-3 space-y-2 mb-3"
        >
            <p class="text-sm font-bold">
                {{ entry.receipt.cashierName }} ·
                {{ formatCurrency(entry.receipt.totalAmount) }} ·
                {{ entry.request.soldAt }}
            </p>
            <p class="text-xs break-all">
                Pending sale key {{ entry.request.idempotencyKey }}
            </p>
            <p v-if="entry.blocked" class="text-sm text-red-800">
                {{ entry.blocked }} Ask an admin to log in on this terminal and
                reconcile this entry.
            </p>
            <template v-if="status.admin">
                <label class="block text-sm"
                    >Reconciliation reason
                    <input
                        v-model="reasons[entry.request.idempotencyKey]"
                        class="block w-full min-h-11 border rounded-lg px-3"
                        :maxlength="STRING_LIMITS.REASON"
                    />
                </label>
                <button
                    type="button"
                    class="min-h-11 px-3 border rounded-lg text-sm font-bold"
                    :disabled="
                        working ||
                        !reasons[entry.request.idempotencyKey]?.trim()
                    "
                    @click="reconcile(entry)"
                >
                    Record collected cash with admin reconciliation
                </button>
            </template>
        </div>
        <template #footer>
            <BaseButton
                variant="outline"
                data-testid="offline-pending-close"
                @click="status.pendingOpen = false"
                >Close</BaseButton
            >
        </template>
    </BaseModal>
</template>
<script setup lang="ts">
import {
    computed,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    watch,
} from 'vue';
import { useOfflineStore } from '@/stores/offline';
import { useAuthStore } from '@/stores/auth';
import { useShiftStore } from '@/stores/shift';
import {
    offlineTerminalSuffix,
    Role,
    STRING_LIMITS,
    type OfflinePendingSale,
} from '@grocery-pos/contracts';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { formatCurrency } from '@/utils/currency';
import { nextProbeDelay } from './probe-backoff';
const status = useOfflineStore();
/** The offset in whole minutes, or seconds below a minute. */
const clockDrift = computed(() => {
    const seconds = Math.round(Math.abs(status.clockOffset) / 1000);
    return seconds < 60
        ? `${seconds} seconds`
        : `${Math.round(seconds / 60)} min`;
});
/** This browser's own id, as the End-shift refusal names it (#454). */
const terminal = computed(() => {
    const id = status.state?.terminalId;
    return id ? offlineTerminalSuffix(id) : '';
});
const auth = useAuthStore();
const shifts = useShiftStore();
const reasons = reactive<Record<string, string>>({});
const working = ref(false);
const failure = ref('');
// A closed dialog forgets its last failure, so reopening starts clean.
watch(
    () => status.pendingOpen,
    (open) => {
        if (!open) failure.value = '';
    },
);
// The browser's online/offline events are hints only: the API itself
// decides (#359), so a local API keeps working without internet.
// The verdict is the probe's alone (#459): a failing prepare or sync on a
// reachable API keeps the 30 s cadence and is tried again then.
async function retry(): Promise<boolean> {
    if (!(await status.probe())) return false;
    try {
        if (shifts.activeShift && auth.user?.roles.includes(Role.Seller))
            await status.prepare(shifts.activeShift);
        await status.sync();
    } catch {
        // Not a connection verdict; the next 30 s retry syncs again.
    }
    await status.refreshPending().catch(() => undefined);
    return true;
}
async function reconcile(entry: OfflinePendingSale) {
    working.value = true;
    failure.value = '';
    try {
        await status.reconcileEntry(
            entry,
            reasons[entry.request.idempotencyKey] ?? '',
        );
    } catch (cause) {
        failure.value =
            cause instanceof Error
                ? cause.message
                : 'Reconciliation failed. The sale is kept.';
    } finally {
        working.value = false;
    }
}
// Probe schedule (#459): every 30 s while the API answers; from the first
// failed probe every 5 s for as long as it fails. One probe at a time, the
// delay counted after the previous one finishes; every
// verdict (timer or browser event) reschedules from its outcome.
let timer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let running = false;
let stopped = false;
// A plain probe only learns the verdict; a retry also prepares and syncs.
type Check = 'probe' | 'retry';
// One queued follow-up for an event that arrived mid-probe; retry wins.
let queued: Check | undefined;
function stopTimer() {
    if (timer) clearTimeout(timer);
    timer = undefined;
}
function schedule() {
    stopTimer();
    if (stopped || !auth.user) return;
    timer = setTimeout(() => void run('retry'), nextProbeDelay(failures));
}
async function run(check: Check): Promise<void> {
    if (stopped) return;
    if (running) {
        if (queued !== 'retry') queued = check;
        return;
    }
    running = true;
    stopTimer();
    let ok: boolean;
    try {
        ok = check === 'retry' ? await retry() : await status.probe();
    } catch {
        ok = false;
    } finally {
        running = false;
    }
    let next = queued;
    queued = undefined;
    // A run that outlived a logout or unmount keeps the timer off.
    if (stopped || !auth.user) return;
    // The API came back after failures: sync now rather than in 30 s.
    if (ok && check === 'probe' && failures > 0) next = 'retry';
    failures = ok ? 0 : failures + 1;
    if (next) void run(next);
    else schedule();
}
const offline = () => {
    void run('probe');
};
const online = () => {
    void run('retry');
};
// Logout stops the timer; a later login on this mount starts over.
watch(
    () => auth.user?.userId,
    (user) => {
        failures = 0;
        queued = undefined;
        if (user) void run('probe');
        else stopTimer();
    },
);
onMounted(() => {
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    // Learn the API's state once now rather than waiting for the timer.
    void run('probe');
});
onBeforeUnmount(() => {
    stopped = true;
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', online);
    stopTimer();
});
</script>
