<template>
    <BaseModal
        v-model="model"
        title="Confirm it's you"
        subtitle="Enter your password to make this change."
        max-width="26rem"
        :closable="!saving"
    >
        <form
            :id="formId"
            class="space-y-4"
            novalidate
            data-testid="reauth-form"
            @submit.prevent="submit"
        >
            <BaseInput
                v-model="password"
                label="Your password"
                type="password"
                autocomplete="current-password"
                data-autofocus
                :error="error"
                @update:model-value="error = ''"
            />
        </form>
        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="saving"
                @click="model = false"
                >Cancel</BaseButton
            >
            <BaseButton type="submit" :form="formId" :loading="saving"
                >Confirm</BaseButton
            >
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { isAxiosError } from 'axios';
import { ErrorCode, type ReauthRequest } from '@grocery-pos/contracts';
import api from '@/axios';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { Color, useUIStore } from '@/stores/ui';
import {
    apiErrorCode,
    apiErrorMessages,
    apiErrorText,
} from '@/utils/api-error';
import { WRONG_REAUTH_PASSWORD } from './reauth';

/**
 * "Confirm it's you" (#310): the step-up before sensitive account changes.
 * `POST /auth/reauth` with the user's own password; on success it emits
 * `confirmed` and the caller retries its save. A wrong password and a rate
 * limit are inline; other failures are toasts. The password lives only
 * here and is cleared whenever the dialog opens or closes.
 */
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ confirmed: []; cancel: [] }>();

const uiStore = useUIStore();
const formId = useId();
const password = ref('');
const error = ref('');
const saving = ref(false);

const model = computed({
    get: () => props.modelValue,
    set: (value: boolean) => {
        if (!value && !saving.value) emit('cancel');
    },
});

watch(
    () => props.modelValue,
    () => {
        password.value = '';
        error.value = '';
    },
);

async function submit() {
    if (saving.value) return;
    if (!password.value) {
        error.value = 'Enter your password';
        return;
    }
    saving.value = true;
    try {
        await api.post('/auth/reauth', {
            password: password.value,
        } satisfies ReauthRequest);
    } catch (err) {
        if (apiErrorCode(err) === ErrorCode.USER_WRONG_PASSWORD) {
            error.value = WRONG_REAUTH_PASSWORD;
        } else if (isAxiosError(err) && err.response?.status === 429) {
            error.value = apiErrorText(
                err,
                'Too many attempts. Try again later.',
            );
        } else {
            uiStore.queueMessage(
                Color.ERROR,
                apiErrorMessages(err, 'Could not confirm your password.'),
            );
        }
        return;
    } finally {
        saving.value = false;
    }
    password.value = '';
    emit('confirmed');
}
</script>
