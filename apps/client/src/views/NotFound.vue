<template>
    <main
        class="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-10 text-center"
    >
        <PageHeader title="Page not found" />
        <EmptyState
            title="There is no page at this address."
            hint="Check the link, or go back to where you can work."
        >
            <template #icon><SearchX :size="24" /></template>
            <template #action>
                <RouterLink
                    :to="home.to"
                    :class="[...buttonClass('primary'), 'min-h-11']"
                    >{{ home.label }}</RouterLink
                >
            </template>
        </EmptyState>
    </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { SearchX } from '@lucide/vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import { buttonClass } from '@/components/ui/button-class';
import { useAuthStore } from '@/stores/auth';
import { notFoundLink } from './not-found-link';

const authStore = useAuthStore();

const home = computed(() =>
    notFoundLink(authStore.isAuthenticated, authStore.user?.roles ?? []),
);
</script>
