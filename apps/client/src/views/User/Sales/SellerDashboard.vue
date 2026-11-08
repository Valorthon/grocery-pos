<template>
    <div class="flex-1 overflow-y-auto bg-paper p-4 sm:p-6 lg:p-8">
        <PageFrame :description="`Welcome back, ${userName}!`">
            <section
                class="bg-surface rounded-card border border-line shadow-card p-5 sm:p-6"
                aria-labelledby="shift-hero-heading"
                data-testid="shift-hero"
                :aria-busy="!shiftStore.loaded && !shiftStore.loadError"
            >
                <div
                    v-if="!shiftStore.loaded && shiftStore.loadError"
                    class="flex flex-wrap items-center gap-3"
                    data-testid="shift-load-error"
                    role="alert"
                >
                    <h2
                        id="shift-hero-heading"
                        class="font-display text-lg font-bold text-danger-fg"
                    >
                        Could not check your shift.
                    </h2>
                    <BaseButton
                        variant="outline"
                        class="min-h-11 min-w-11"
                        data-testid="shift-retry"
                        :loading="retrying"
                        @click="retry"
                    >
                        Retry
                    </BaseButton>
                </div>
                <div
                    v-else-if="!shiftStore.loaded"
                    class="flex items-center gap-3 text-muted"
                    data-testid="shift-loading"
                    role="status"
                >
                    <Spinner size="sm" />
                    <h2
                        id="shift-hero-heading"
                        class="font-display text-lg font-bold text-ink"
                    >
                        Checking your shift…
                    </h2>
                </div>

                <template v-else>
                    <div class="flex flex-wrap items-start gap-4">
                        <div
                            class="w-11 h-11 rounded-control flex items-center justify-center shrink-0"
                            :class="
                                shift
                                    ? 'bg-leaf-50 text-leaf-700'
                                    : 'bg-paper text-muted'
                            "
                        >
                            <Clock class="w-5 h-5" />
                        </div>
                        <div class="min-w-0 flex-1">
                            <h2
                                id="shift-hero-heading"
                                class="font-display text-xl font-bold text-ink"
                                data-testid="shift-status"
                            >
                                {{ shift ? 'Shift open' : 'No open shift' }}
                            </h2>
                            <dl
                                v-if="shift"
                                class="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3"
                            >
                                <div>
                                    <dt class="text-muted">Opened at</dt>
                                    <dd
                                        class="font-bold text-ink"
                                        data-testid="shift-opened-at"
                                    >
                                        {{
                                            formatStoreDateTime(shift.openedAt)
                                        }}
                                    </dd>
                                </div>
                                <div>
                                    <dt class="text-muted">Open for</dt>
                                    <dd
                                        class="font-bold text-ink"
                                        data-testid="shift-duration"
                                    >
                                        {{ openFor }}
                                    </dd>
                                </div>
                                <div>
                                    <dt class="text-muted">Terminal</dt>
                                    <dd class="font-bold text-ink">
                                        {{ shift.terminal }}
                                    </dd>
                                </div>
                            </dl>
                            <p v-else class="mt-1 text-sm text-muted">
                                Count your opening float to start selling.
                            </p>
                        </div>
                    </div>
                </template>

                <div class="mt-5 flex flex-wrap gap-3">
                    <template v-if="shiftStore.loaded">
                        <BaseButton
                            v-if="shift"
                            variant="accent"
                            size="lg"
                            class="min-h-11 min-w-11"
                            data-testid="go-to-register"
                            @click="router.push({ name: 'Sell' })"
                        >
                            <template #icon>
                                <ShoppingCart class="w-5 h-5" />
                            </template>
                            Go to register
                        </BaseButton>
                        <BaseButton
                            v-else
                            variant="accent"
                            size="lg"
                            class="min-h-11 min-w-11"
                            data-testid="start-shift"
                            @click="shiftStore.shiftInOpen = true"
                        >
                            <template #icon>
                                <Banknote class="w-5 h-5" />
                            </template>
                            Start shift
                        </BaseButton>
                        <BaseButton
                            v-if="shift"
                            variant="outline"
                            size="lg"
                            class="min-h-11 min-w-11"
                            data-testid="end-shift"
                            @click="shiftStore.shiftOutOpen = true"
                        >
                            <template #icon>
                                <Calculator class="w-5 h-5" />
                            </template>
                            End shift
                        </BaseButton>
                    </template>
                    <BaseButton
                        variant="outline"
                        size="lg"
                        class="min-h-11 min-w-11"
                        data-testid="last-shift-report"
                        :loading="loadingReport"
                        @click="showLastReport"
                    >
                        <template #icon>
                            <FileText class="w-5 h-5" />
                        </template>
                        Last Z-read
                    </BaseButton>
                </div>
            </section>
        </PageFrame>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
    Banknote,
    Calculator,
    Clock,
    FileText,
    ShoppingCart,
} from '@lucide/vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import Spinner from '@/components/ui/Spinner.vue';
import { useAuthStore } from '@/stores/auth';
import { apiErrorMessage, useShiftStore } from '@/stores/shift';
import { Color, useUIStore } from '@/stores/ui';
import { formatStoreDateTime } from '@/utils/datetime';
import { formatShiftDuration } from './shift-duration';

// Blind until the count is submitted (issue #2): no drawer or sales figures.
const router = useRouter();
const authStore = useAuthStore();
const shiftStore = useShiftStore();
const uiStore = useUIStore();

const userName = computed(() => authStore.user?.username ?? 'seller');
const shift = computed(() => shiftStore.activeShift);
const loadingReport = ref(false);
const retrying = ref(false);

async function retry() {
    retrying.value = true;
    try {
        await shiftStore.fetchCurrent();
    } catch {
        // loadError stays set; the inline error keeps its Retry.
    } finally {
        retrying.value = false;
    }
}

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    timer = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => clearInterval(timer));

const openFor = computed(() =>
    shift.value ? formatShiftDuration(shift.value.openedAt, now.value) : '',
);

async function showLastReport() {
    loadingReport.value = true;
    try {
        if (!(await shiftStore.showLastReport())) {
            uiStore.queueMessage(Color.INFO, 'No closed shift yet');
        }
    } catch (err) {
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessage(err, 'Could not load the last shift report'),
        );
    } finally {
        loadingReport.value = false;
    }
}
</script>
