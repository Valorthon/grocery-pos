<template>
    <BaseModal
        :model-value="!!request"
        :title="shown.title"
        max-width="24rem"
        @update:model-value="(open) => !open && emit('answer', false)"
    >
        <p :id="messageId" class="text-sm text-slate-600">
            {{ shown.message }}
        </p>
        <template #footer>
            <BaseButton
                ref="cancelButton"
                variant="outline"
                :aria-describedby="messageId"
                @click="emit('answer', false)"
                >{{ shown.cancelLabel ?? 'Cancel' }}</BaseButton
            >
            <BaseButton
                :class="[
                    'flex-1',
                    shown.danger
                        ? 'bg-red-600! hover:bg-red-700! active:bg-red-800!'
                        : '',
                ]"
                :aria-describedby="messageId"
                @click="emit('answer', true)"
                >{{ shown.confirmLabel ?? 'Confirm' }}</BaseButton
            >
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { nextTick, ref, useId, useTemplateRef, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import BaseButton from './BaseButton.vue';
import type { ConfirmRequest } from '@/composables/useConfirm';

/**
 * A yes/no question on top of the page (issue #19); pair it with
 * `useConfirm`. The safe choice (Cancel) takes the focus, so Enter and
 * Escape both keep things as they are; the focus goes back to where it
 * was once answered.
 */
const props = defineProps<{ request: ConfirmRequest | null }>();
const emit = defineEmits<{ (e: 'answer', ok: boolean): void }>();

const messageId = useId();
const cancelButton = useTemplateRef<{ $el: HTMLElement }>('cancelButton');

// Keeps the text while the modal fades out after an answer.
const shown = ref<ConfirmRequest>({ title: '', message: '' });

// Where the focus was when the question opened (the button that asked),
// given back once it is answered.
let returnFocus: HTMLElement | null = null;

watch(
    () => props.request,
    async (request, previous) => {
        if (!request) {
            const target = returnFocus;
            returnFocus = null;
            await nextTick();
            if (target?.isConnected) target.focus();
            return;
        }
        if (!previous) {
            const active = document.activeElement;
            returnFocus = active instanceof HTMLElement ? active : null;
        }
        shown.value = request;
        await nextTick();
        cancelButton.value?.$el.focus();
    },
    { immediate: true },
);
</script>
