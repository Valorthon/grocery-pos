<template>
    <!-- Inside the user's own layout when logged in, so the sidebar is
         there (#193); standalone for a visitor. The router guards only
         decide where a route may go; the layouts hold no guards, and the
         layout picked is the one the user's home page uses. -->
    <component :is="frame ?? 'main'" :data-layout="frameName">
        <div
            :class="[
                'flex flex-col items-center justify-center px-6 py-10 text-center',
                frame ? 'min-h-full' : 'min-h-screen bg-paper',
            ]"
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
        </div>
    </component>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { RouterLink } from 'vue-router';
import { SearchX } from '@lucide/vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import { buttonClass } from '@/components/ui/button-class';
import { useAuthStore } from '@/stores/auth';
import { notFoundLink } from './not-found-link';

const UserLayout = defineAsyncComponent(
    () => import('@/layouts/UserLayout.vue'),
);
const SellerLayout = defineAsyncComponent(
    () => import('@/layouts/SellerLayout.vue'),
);

const authStore = useAuthStore();

const home = computed(() =>
    notFoundLink(authStore.isAuthenticated, authStore.user?.roles ?? []),
);

/** The layout of the user's home page; none for a visitor. */
const frameName = computed(() => {
    if (home.value.to.name === 'SellerDashboard') return 'seller';
    if (home.value.to.name === 'Dashboard') return 'user';
    return undefined;
});
const frame = computed(() =>
    frameName.value === 'seller'
        ? SellerLayout
        : frameName.value === 'user'
          ? UserLayout
          : undefined,
);
</script>
