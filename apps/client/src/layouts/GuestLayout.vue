<template>
    <div
        class="min-h-screen flex flex-col bg-[#f8fafc] text-slate-900 antialiased"
    >
        <GuestAppbar v-if="!route.meta.hideAppBar" />
        <main class="flex-1">
            <router-view />
        </main>
        <GuestFooter v-if="!route.meta.hideFooter" />
    </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import GuestAppbar from '@/components/Guest/Navigation/GuestAppbar.vue';
import GuestFooter from '@/components/Guest/Navigation/GuestFooter.vue';

const route = useRoute();
</script>
