<template>
    <!--
        Outside the app root, and exempt from the inert background while a
        modal is open (issue #22): a failed save's toast must stay readable
        and dismissable over the dialog that is still open.
    -->
    <Teleport to="body">
        <div
            data-inert-exempt
            class="fixed top-4 right-4 z-[60] flex flex-col gap-2 items-end max-w-[calc(100vw-2rem)] sm:max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto"
            data-testid="toast-stack"
        >
            <!-- Errors: each one is an alert, announced as it appears. -->
            <TransitionGroup
                tag="div"
                class="flex flex-col gap-2 items-end"
                v-bind="transition"
            >
                <ToastItem
                    v-for="toast in errors"
                    :key="toast.id"
                    role="alert"
                    :toast="toast"
                    @dismiss="uiStore.dismiss(toast.id)"
                />
            </TransitionGroup>
            <!--
            Success and info: one live region that is always in the page,
            so a toast added to it is announced (politely).
        -->
            <TransitionGroup
                tag="div"
                class="flex flex-col gap-2 items-end"
                role="status"
                aria-live="polite"
                data-testid="toast-status"
                v-bind="transition"
            >
                <ToastItem
                    v-for="toast in notices"
                    :key="toast.id"
                    :toast="toast"
                    @dismiss="uiStore.dismiss(toast.id)"
                />
            </TransitionGroup>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Color, useUIStore } from '@/stores/ui';
import ToastItem from './ToastItem.vue';

/**
 * Every queued message, stacked (issue #18), errors above the rest.
 * Errors stay until closed and are announced (`role="alert"`); success
 * and info close by themselves (the store times them) and are announced
 * politely. A long stack scrolls instead of covering the page.
 */
const uiStore = useUIStore();

const errors = computed(() =>
    uiStore.toasts.filter((t) => t.color === Color.ERROR),
);
const notices = computed(() =>
    uiStore.toasts.filter((t) => t.color !== Color.ERROR),
);

const transition = {
    enterActiveClass: 'transition duration-200 ease-out',
    enterFromClass: 'opacity-0 -translate-y-2',
    enterToClass: 'opacity-100 translate-y-0',
    leaveActiveClass: 'transition duration-200 ease-in',
    leaveFromClass: 'opacity-100',
    leaveToClass: 'opacity-0',
};
</script>
