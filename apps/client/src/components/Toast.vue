<template>
    <!--
        Outside the app root, and exempt from the inert background while a
        modal is open (issue #22): a failed save's toast must stay readable
        and dismissable over the dialog that is still open.
    -->
    <Teleport to="body">
        <div
            data-inert-exempt
            :class="[
                'fixed z-[60] flex flex-col gap-2 max-w-[calc(100vw-2rem)] sm:max-w-md overflow-y-auto',
                placement.stack,
            ]"
            :data-placement="uiStore.toastPlacement"
            data-testid="toast-stack"
        >
            <!-- Errors: each one is an alert, announced as it appears. -->
            <TransitionGroup
                tag="div"
                :class="['flex flex-col gap-2', placement.items]"
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
                :class="['flex flex-col gap-2', placement.items]"
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
import { Color, type ToastPlacement, useUIStore } from '@/stores/ui';
import ToastItem from './ToastItem.vue';

/**
 * Every queued message, stacked (issue #18), errors above the rest.
 * Errors stay until closed and are announced (`role="alert"`); success
 * and info close by themselves (the store times them) and are announced
 * politely. A long stack scrolls instead of covering the page.
 *
 * Where it sits is the layout's choice (`uiStore.toastPlacement`, #85):
 * top-right in the admin layout; bottom-center in the seller layout, so
 * it never covers the register's scan box or the top of the ticket.
 */
const uiStore = useUIStore();

const errors = computed(() =>
    uiStore.toasts.filter((t) => t.color === Color.ERROR),
);
const notices = computed(() =>
    uiStore.toasts.filter((t) => t.color !== Color.ERROR),
);

/** The stack's position and its toasts' alignment, per placement. */
const PLACEMENTS: Record<ToastPlacement, { stack: string; items: string }> = {
    'top-right': {
        stack: 'top-4 right-4 items-end max-h-[calc(100vh-2rem)]',
        items: 'items-end',
    },
    'bottom-center': {
        stack: 'bottom-4 left-1/2 -translate-x-1/2 items-center max-h-[calc(100vh-2rem)]',
        items: 'items-center',
    },
    // Below lg: above the sticky Tender footer (about 4.5rem tall). From
    // lg there is no footer; the stack is centred on the space left of
    // the 400px tender panel, so it never covers Tender & Charge.
    register: {
        stack: 'bottom-24 left-1/2 -translate-x-1/2 items-center max-h-[calc(100vh-7rem)] lg:bottom-4 lg:left-[calc(50%-200px)] lg:max-h-[calc(100vh-2rem)]',
        items: 'items-center',
    },
};

const placement = computed(() => PLACEMENTS[uiStore.toastPlacement]);

/** A toast slides in from the edge it sits at. */
const transition = computed(() => ({
    enterActiveClass: 'transition duration-200 ease-out',
    enterFromClass:
        uiStore.toastPlacement === 'top-right'
            ? 'opacity-0 -translate-y-2'
            : 'opacity-0 translate-y-2',
    enterToClass: 'opacity-100 translate-y-0',
    leaveActiveClass: 'transition duration-200 ease-in',
    leaveFromClass: 'opacity-100',
    leaveToClass: 'opacity-0',
}));
</script>
