<template>
    <div
        v-if="
            status.offline ||
            status.ready ||
            status.pending.length ||
            status.error
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
        <span v-if="status.offline">{{
            status.ready
                ? 'Cached prices; no discounts, GCash, voids or refunds.'
                : 'Offline cash is not prepared. Reconnect before selling.'
        }}</span>
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
                Receipt {{ entry.request.idempotencyKey }}
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
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useOfflineStore } from '@/stores/offline';
import { useAuthStore } from '@/stores/auth';
import { useShiftStore } from '@/stores/shift';
import {
    Role,
    STRING_LIMITS,
    type OfflinePendingSale,
} from '@grocery-pos/contracts';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { formatCurrency } from '@/utils/currency';
const status = useOfflineStore();
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
async function retry() {
    status.setConnection(navigator.onLine);
    if (shifts.activeShift && auth.user?.roles.includes(Role.Seller))
        await status.prepare(shifts.activeShift);
    await status.sync();
    await status.refreshPending().catch(() => undefined);
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
const offline = () => status.setConnection(false);
const online = () => {
    void retry();
};
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    timer = setInterval(() => {
        void retry();
    }, 30000);
});
onBeforeUnmount(() => {
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', online);
    if (timer) clearInterval(timer);
});
</script>
