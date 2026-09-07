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
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Navigation from '@/components/User/Sales/Navigation.vue';
import CollapsibleSidebar from '@/components/User/Sales/CollapsibleSidebar.vue';
import ShiftInModal from '@/components/User/Sales/ShiftInModal.vue';
import DrawerActionModal from '@/components/User/Sales/DrawerActionModal.vue';
import ShiftOutModal from '@/components/User/Sales/ShiftOutModal.vue';
import ZReadModal from '@/components/User/Sales/ZReadModal.vue';
import { useShiftStore } from '@/stores/shift';

const route = useRoute();
const router = useRouter();
const shiftStore = useShiftStore();

const isDashboard = computed(() => route.name === 'SellerDashboard');

watch(
    () => route.name,
    (name) => {
        if (name === 'Sell' && !shiftStore.activeShift) {
            shiftStore.shiftInOpen = true;
            router.replace({ name: 'SellerDashboard' });
        }
    },
    { immediate: true },
);

watch(
    () => shiftStore.activeShift,
    (shift) => {
        if (!shift && route.name === 'Sell') {
            router.replace({ name: 'SellerDashboard' });
        }
    },
);
</script>
