<template>
    <BaseModal
        :model-value="!!request"
        :title="shown.title"
        max-width="24rem"
        @update:model-value="(open) => !open && emit('answer', false)"
    >
        <p :id="messageId" class="text-sm text-muted">
            {{ shown.message }}
        </p>
        <template #footer>
            <BaseButton
                data-autofocus
                variant="outline"
                :aria-describedby="messageId"
                @click="emit('answer', false)"
                >{{ shown.cancelLabel ?? 'Cancel' }}</BaseButton
            >
            <BaseButton
                :variant="shown.danger ? 'danger-solid' : 'primary'"
                :aria-describedby="messageId"
                @click="emit('answer', true)"
                >{{ shown.confirmLabel ?? 'Confirm' }}</BaseButton
            >
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { ref, useId, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import BaseButton from './BaseButton.vue';
import type { ConfirmRequest } from '@/composables/useConfirm';

/**
 * A yes/no question on top of the page (issue #19); pair it with
 * `useConfirm`. The safe choice (Cancel) takes the focus (`data-autofocus`),
 * so Enter and Escape both keep things as they are. BaseModal gives the
 * focus back to where it was once answered (issue #22).
 */
const props = defineProps<{ request: ConfirmRequest | null }>();
const emit = defineEmits<{ (e: 'answer', ok: boolean): void }>();

const messageId = useId();

// Keeps the text while the modal fades out after an answer.
const shown = ref<ConfirmRequest>({ title: '', message: '' });

watch(
    () => props.request,
    (request) => {
        if (request) shown.value = request;
    },
    { immediate: true },
);
</script>
