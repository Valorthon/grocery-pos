<template>
    <div
        class="mx-auto w-full"
        :class="narrow ? 'max-w-3xl' : 'max-w-7xl'"
        data-testid="page-frame"
    >
        <PageHeader
            :title="shownTitle"
            :description="shownDescription"
            :breadcrumbs="breadcrumbs"
        >
            <template v-if="$slots.actions" #actions>
                <slot name="actions" />
            </template>
        </PageHeader>
        <div v-if="$slots.chips" class="-mt-4 mb-4 flex flex-wrap gap-2">
            <slot name="chips" />
        </div>
        <div class="space-y-5">
            <slot />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { routeDescription, routeTitle } from '@/router/page-title';
import PageHeader from './PageHeader.vue';
import type { Breadcrumb } from './page-primitives';

/**
 * The admin page frame (#159): the page's one h1 (PageHeader, titled from
 * the route's `meta.title`, as the browser tab is), its actions, and a
 * content column about 80rem wide (`narrow` for forms such as Settings).
 */
const props = defineProps<{
    /** Overrides the route title (tests, or a page outside the router). */
    title?: string;
    /** Overrides the route's summary (#262), e.g. the dashboards' greeting. */
    description?: string;
    breadcrumbs?: Breadcrumb[];
    narrow?: boolean;
}>();

const route = useRoute();
const shownTitle = computed(
    () => props.title ?? (route ? routeTitle(route) : undefined) ?? '',
);
const shownDescription = computed(
    () => props.description ?? (route ? routeDescription(route) : undefined),
);
</script>
