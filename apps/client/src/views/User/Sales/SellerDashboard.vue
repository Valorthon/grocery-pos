<template>
    <div
        class="flex-1 overflow-y-auto bg-[#f8fafc] p-6 sm:p-10 flex flex-col justify-start"
    >
        <div class="max-w-5xl mx-auto w-full space-y-8 mt-2">
            <div class="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1
                        class="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight"
                    >
                        Dashboard
                    </h1>
                    <p
                        class="text-base sm:text-lg text-slate-500 font-medium mt-1"
                    >
                        Welcome back, {{ userName }}!
                    </p>
                </div>

                <div
                    v-if="shiftStore.activeShift"
                    class="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-1.5 rounded-xl text-xs font-bold"
                >
                    <span
                        class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
                    />
                    <span
                        >Active Shift •
                        {{ shiftStore.activeShift.terminal }}</span
                    >
                </div>
                <div
                    v-else-if="!shiftStore.loaded"
                    class="flex items-center gap-2 bg-slate-100 border border-slate-200 text-slate-500 px-3 py-1.5 rounded-xl text-xs font-bold"
                >
                    <span class="w-2 h-2 rounded-full bg-slate-300" />
                    <span>Checking shift…</span>
                </div>
                <div
                    v-else
                    class="flex items-center gap-2 bg-slate-100 border border-slate-200 text-slate-600 px-3 py-1.5 rounded-xl text-xs font-bold"
                >
                    <span class="w-2 h-2 rounded-full bg-slate-400" />
                    <span>No Active Shift • Shift In Required</span>
                </div>
            </div>

            <div class="flex flex-wrap gap-6">
                <button
                    v-if="!shiftStore.activeShift && shiftStore.loaded"
                    type="button"
                    class="group text-left bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white rounded-2xl p-5 shadow-xs hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 flex flex-col justify-between w-64 h-36 sm:h-40"
                    @click="shiftStore.shiftInOpen = true"
                >
                    <div
                        class="w-10 h-10 rounded-xl bg-white/20 text-white flex items-center justify-center border border-white/25 group-hover:bg-white/30 transition-all"
                    >
                        <Banknote class="w-5 h-5" />
                    </div>

                    <div>
                        <div
                            class="text-xl sm:text-2xl font-black text-white tracking-tight"
                        >
                            Start Shift
                        </div>
                        <p class="text-xs text-white/80 mt-1">
                            Count opening float & open register
                        </p>
                    </div>
                </button>

                <template v-else-if="shiftStore.activeShift">
                    <button
                        type="button"
                        class="group text-left bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white rounded-2xl p-5 shadow-xs hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 flex flex-col justify-between w-64 h-36 sm:h-40"
                        @click="router.push({ name: 'Sell' })"
                    >
                        <div
                            class="w-10 h-10 rounded-xl bg-white/20 text-white flex items-center justify-center border border-white/25 group-hover:bg-white/30 transition-all"
                        >
                            <ShoppingCart class="w-5 h-5" />
                        </div>

                        <div>
                            <div
                                class="text-xl sm:text-2xl font-black text-white tracking-tight"
                            >
                                Go to Register
                            </div>
                            <p class="text-xs text-white/80 mt-1">
                                Ring up items & accept payments
                            </p>
                        </div>
                    </button>

                    <button
                        type="button"
                        class="group text-left bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-2xl p-5 shadow-xs hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 flex flex-col justify-between w-64 h-36 sm:h-40"
                        @click="shiftStore.shiftOutOpen = true"
                    >
                        <div
                            class="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center"
                        >
                            <Calculator class="w-5 h-5" />
                        </div>

                        <div>
                            <div
                                class="text-xl sm:text-2xl font-black text-slate-900 tracking-tight"
                            >
                                End Shift
                            </div>
                            <p class="text-xs text-slate-500 mt-1">
                                Count drawer & generate Z-Read
                            </p>
                        </div>
                    </button>
                </template>

                <button
                    type="button"
                    class="group text-left bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-2xl p-5 shadow-xs hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 flex flex-col justify-between w-64 h-36 sm:h-40 disabled:opacity-60"
                    data-testid="last-shift-report"
                    :disabled="loadingReport"
                    @click="showLastReport"
                >
                    <div
                        class="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 border border-slate-200 flex items-center justify-center"
                    >
                        <FileText class="w-5 h-5" />
                    </div>

                    <div>
                        <div
                            class="text-xl sm:text-2xl font-black text-slate-900 tracking-tight"
                        >
                            Last Shift Report
                        </div>
                        <p class="text-xs text-slate-500 mt-1">
                            Reopen your last Z-read
                        </p>
                    </div>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Banknote, Calculator, FileText, ShoppingCart } from '@lucide/vue';
import { useAuthStore } from '@/stores/auth';
import { apiErrorMessage, useShiftStore } from '@/stores/shift';
import { Color, useUIStore } from '@/stores/ui';

// Blind until the count is submitted (issue #2): no drawer figures here.
const router = useRouter();
const authStore = useAuthStore();
const shiftStore = useShiftStore();
const uiStore = useUIStore();

const userName = computed(() => authStore.user?.username ?? 'seller');
const loadingReport = ref(false);

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
