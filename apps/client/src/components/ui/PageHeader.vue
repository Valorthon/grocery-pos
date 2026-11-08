<template>
    <header class="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div class="min-w-0">
            <nav
                v-if="breadcrumbs?.length"
                aria-label="Breadcrumb"
                class="mb-1"
            >
                <ol
                    class="flex flex-wrap items-center gap-1 text-xs text-muted"
                >
                    <li
                        v-for="(crumb, i) in breadcrumbs"
                        :key="i"
                        class="flex items-center gap-1"
                    >
                        <ChevronRight
                            v-if="i > 0"
                            :size="12"
                            aria-hidden="true"
                        />
                        <span
                            v-if="i === breadcrumbs.length - 1"
                            aria-current="page"
                            class="inline-flex min-h-6 items-center"
                            >{{ crumb.label }}</span
                        >
                        <RouterLink
                            v-else-if="crumb.to"
                            :to="crumb.to"
                            class="inline-flex min-h-6 items-center rounded px-0.5 hover:text-ink hover:underline focus-ring"
                        >
                            {{ crumb.label }}
                        </RouterLink>
                        <span v-else class="inline-flex min-h-6 items-center">{{
                            crumb.label
                        }}</span>
                    </li>
                </ol>
            </nav>
            <h1
                class="font-display text-2xl font-extrabold text-ink leading-tight"
            >
                {{ title }}
            </h1>
            <p v-if="description" class="mt-1 text-sm text-muted">
                {{ description }}
            </p>
        </div>
        <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
            <slot name="actions" />
        </div>
    </header>
</template>

<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';
import type { Breadcrumb } from './page-primitives';

defineProps<{
    /** The page's one h1. */
    title: string;
    description?: string;
    breadcrumbs?: Breadcrumb[];
}>();
</script>
