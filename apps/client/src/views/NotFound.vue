<template>
    <main
        class="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper px-6 py-10 text-center"
    >
        <span
            class="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-leaf-50 text-leaf-700"
            aria-hidden="true"
        >
            <SearchX :size="24" />
        </span>
        <p class="text-sm font-bold text-muted">404</p>
        <h1 class="text-2xl font-bold text-ink">Page not found</h1>
        <p class="max-w-sm text-sm text-muted">
            There is no page at this address. Check the link, or go back to
            where you can work.
        </p>
        <RouterLink
            :to="home.to"
            class="mt-2 inline-flex min-h-11 items-center justify-center rounded-control bg-leaf-600 px-5 text-sm font-bold text-white shadow-card hover:bg-leaf-700 active:bg-leaf-800 focus-ring"
            >{{ home.label }}</RouterLink
        >
    </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { SearchX } from '@lucide/vue';
import { useAuthStore } from '@/stores/auth';
import { notFoundLink } from './not-found-link';

const authStore = useAuthStore();

const home = computed(() =>
    notFoundLink(authStore.isAuthenticated, authStore.user?.roles ?? []),
);
</script>
