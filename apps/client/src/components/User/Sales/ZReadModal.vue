<template>
    <BaseModal v-model="open" max-width="28rem" scrollable>
        <template #header>
            <div class="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 class="w-4 h-4 text-emerald-600" />
                <span class="text-xs font-bold"
                    >Shift Close Report (Z-Read)</span
                >
            </div>
        </template>

        <div class="p-4 sm:p-5 overflow-y-auto bg-slate-100">
            <ZReadReportView v-if="report" :report="report" />
        </div>

        <template #footer>
            <BaseButton class="flex-1" @click="done">
                Back to Dashboard
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CheckCircle2 } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import ZReadReportView from './ZReadReportView.vue';
import { useShiftStore } from '@/stores/shift';

/**
 * Shows the Z-read the server stored when the shift closed. Closing the
 * modal only hides it: the report is kept on the server and reopens from
 * the dashboard's "Last shift report".
 */
const shiftStore = useShiftStore();

const report = computed(() => shiftStore.zRead);

const open = computed({
    get: () => shiftStore.zRead !== null,
    set: (val) => {
        if (!val) shiftStore.zRead = null;
    },
});

async function done() {
    shiftStore.zRead = null;
    const { default: router } = await import('@/router');
    router.push({ name: 'SellerDashboard' });
}
</script>
