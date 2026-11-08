<template>
    <div
        class="h-screen w-screen overflow-hidden flex bg-paper text-slate-900 antialiased"
    >
        <UserSidebar v-model="drawer" />

        <div class="flex-1 flex flex-col min-w-0">
            <UserAppbar :drawer-open="drawer" @open-drawer="drawer = true" />

            <OfflineStatus />
            <main class="flex-1 overflow-y-auto p-4 sm:p-6">
                <router-view />
            </main>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useStoreSettings } from '@/composables/useStoreSettings';
useStoreSettings();
import { ref, onMounted } from 'vue';
import OfflineStatus from '@/components/User/Sales/OfflineStatus.vue';
import { useOfflineStore } from '@/stores/offline';
import { useAuthStore } from '@/stores/auth';
import UserAppbar from '@/components/User/Navigation/UserAppbar.vue';
import UserSidebar from '@/components/User/Navigation/UserSidebar.vue';

/** The sidebar drawer below lg (#89). */
const drawer = ref(false);
onMounted(() => {
    const user = useAuthStore().user;
    if (user?.userId) void useOfflineStore().restore(user.userId, user.roles);
});
</script>
