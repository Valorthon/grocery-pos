<template>
    <div
        class="h-screen w-screen overflow-hidden flex flex-col bg-[#f8fafc] text-slate-900 antialiased"
    >
        <template v-if="isDashboard">
            <Navigation />
            <main class="flex-1 overflow-hidden">
                <router-view />
            </main>
        </template>

        <template v-else>
            <div class="flex-1 flex flex-row h-full w-full overflow-hidden">
                <CollapsibleSidebar />
                <main
                    class="flex-1 flex flex-col h-screen overflow-hidden min-w-0"
                >
                    <router-view />
                </main>
            </div>
        </template>

        <ShiftInModal />
        <DrawerActionModal />
        <ShiftOutModal />
        <ZReadModal />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Navigation from '@/components/User/Sales/Navigation.vue';
import CollapsibleSidebar from '@/components/User/Sales/CollapsibleSidebar.vue';
import ShiftInModal from '@/components/User/Sales/ShiftInModal.vue';
import DrawerActionModal from '@/components/User/Sales/DrawerActionModal.vue';
import ShiftOutModal from '@/components/User/Sales/ShiftOutModal.vue';
import ZReadModal from '@/components/User/Sales/ZReadModal.vue';
import { useShiftStore } from '@/stores/shift';
import { Color, useUIStore } from '@/stores/ui';

const route = useRoute();
const router = useRouter();
const shiftStore = useShiftStore();
const uiStore = useUIStore();

const isDashboard = computed(() => route.name === 'SellerDashboard');

/**
 * The register needs an open shift, and the server is the judge (issue #2):
 * once it has answered and there is none, the cashier is sent to the
 * dashboard to open one. The server refuses a sale without one anyway.
 */
function requireShift() {
    if (route.name === 'Sell' && shiftStore.loaded && !shiftStore.activeShift) {
        shiftStore.shiftInOpen = true;
        router.replace({ name: 'SellerDashboard' });
    }
}

// On every sign-in and page load: resume the caller's open shift, if any.
onMounted(async () => {
    try {
        await shiftStore.fetchCurrent();
    } catch {
        uiStore.queueMessage(
            Color.ERROR,
            'Could not check your shift. Reload to try again.',
        );
    }
    requireShift();
});

watch(() => route.name, requireShift);

watch(
    () => shiftStore.activeShift,
    (shift, previous) => {
        // `loaded` is cleared by a reset (logout): nothing to report then.
        if (shift || !previous || !shiftStore.loaded) return;
        // Closed by the cashier: the Z-read is on screen. Otherwise it was
        // closed elsewhere (an admin force-closed it).
        if (!shiftStore.zRead) {
            uiStore.queueMessage(
                Color.ERROR,
                'Your shift is no longer open. Open a new shift to keep selling.',
            );
            requireShift();
            return;
        }
        if (route.name === 'Sell') {
            router.replace({ name: 'SellerDashboard' });
        }
    },
);
</script>
