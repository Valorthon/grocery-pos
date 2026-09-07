<template>
    <div
        class="h-screen w-screen overflow-hidden flex bg-[#f8fafc] text-slate-900 antialiased"
    >
        <UserSidebar v-model="drawer" />

        <div class="flex-1 flex flex-col min-w-0">
            <UserAppbar @toggle-drawer="drawer = !drawer" />

            <main class="flex-1 overflow-y-auto p-4 sm:p-6">
                <router-view />
            </main>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import UserAppbar from '@/components/User/Navigation/UserAppbar.vue';
import UserSidebar from '@/components/User/Navigation/UserSidebar.vue';

const drawer = ref(false);
</script>
