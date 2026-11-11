<template>
    <component
        :is="to ? RouterLink : 'div'"
        :to="to"
        :aria-busy="loading ? 'true' : undefined"
        :class="[
            'relative flex flex-col gap-1 overflow-hidden rounded-card border border-line bg-surface p-4 shadow-card',
            to
                ? 'group transition-colors hover:border-leaf-600 hover:bg-paper focus-ring'
                : '',
        ]"
    >
        <!-- Tone is a 4px *-fg stripe (3:1 on surface) plus sr-only text,
             never colour alone (#157 review). -->
        <span
            v-if="tone !== 'neutral'"
            data-tone-stripe
            :class="['absolute inset-y-0 left-0 w-1', STRIPE[tone]]"
            aria-hidden="true"
        />
        <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1">
                <p class="text-xs font-semibold text-muted">
                    {{ label
                    }}<span v-if="tone !== 'neutral'" class="sr-only"
                        >, {{ toneText }}</span
                    >
                </p>
                <!-- -my-3 keeps the 44px trigger from making the label
                     row taller than a text line (#271). -->
                <InfoTooltip
                    v-if="help"
                    class="-my-3 -ml-3.5"
                    :label="`About ${label.toLowerCase()}`"
                    >{{ help }}</InfoTooltip
                >
            </div>
            <span v-if="$slots.icon" class="text-muted" aria-hidden="true">
                <slot name="icon" />
            </span>
        </div>
        <p
            v-if="loading"
            class="h-8 w-24 animate-pulse rounded-control bg-line"
            data-skeleton
        >
            <span class="sr-only">Loading</span>
        </p>
        <p
            v-else
            class="font-display num text-2xl font-extrabold text-ink leading-tight"
        >
            {{ value }}
        </p>
        <p v-if="hint" class="text-xs text-muted">{{ hint }}</p>
        <slot />
        <!-- A linked tile says so, not only on hover (#193). -->
        <span
            v-if="to"
            data-tile-link
            class="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-leaf-700 group-hover:underline"
            aria-hidden="true"
            >View<ChevronRight :size="14"
        /></span>
    </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { ChevronRight } from '@lucide/vue';
import InfoTooltip from './InfoTooltip.vue';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

const STRIPE: Record<Exclude<Tone, 'neutral'>, string> = {
    success: 'bg-success-fg',
    warning: 'bg-warning-fg',
    danger: 'bg-danger-fg',
};

const DEFAULT_TONE_TEXT: Record<Exclude<Tone, 'neutral'>, string> = {
    success: 'good',
    warning: 'warning',
    danger: 'needs attention',
};

const props = withDefaults(
    defineProps<{
        label: string;
        /** Already formatted (formatCurrency, quantity formatting, …). */
        value?: string | number;
        hint?: string;
        tone?: Tone;
        /** Screen-reader word for the tone; defaults per tone. */
        toneLabel?: string;
        /** Makes the whole tile a link. */
        to?: RouteLocationRaw;
        /** Shows a skeleton in place of the value. */
        loading?: boolean;
        /** An ⓘ note after the label (#271). */
        help?: string;
    }>(),
    {
        value: '',
        hint: undefined,
        tone: 'neutral',
        toneLabel: undefined,
        to: undefined,
        loading: false,
        help: undefined,
    },
);

const toneText = computed(() =>
    props.tone === 'neutral'
        ? ''
        : (props.toneLabel ?? DEFAULT_TONE_TEXT[props.tone]),
);
</script>
