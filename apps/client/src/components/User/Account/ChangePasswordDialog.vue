<template>
    <BaseModal
        v-model="model"
        title="Change password"
        subtitle="After the change, you log in again with the new password."
        max-width="28rem"
        :closable="!saving"
    >
        <form
            :id="formId"
            class="space-y-4"
            novalidate
            data-testid="change-password-form"
            @submit.prevent="save"
        >
            <BaseInput
                v-model="form.currentPassword"
                label="Current password"
                type="password"
                autocomplete="current-password"
                data-autofocus
                :error="errors.currentPassword"
                @update:model-value="clearError('currentPassword')"
            />
            <BaseInput
                v-model="form.newPassword"
                label="New password"
                type="password"
                autocomplete="new-password"
                :placeholder="PASSWORD_HINT"
                :error="errors.newPassword"
                @update:model-value="clearError('newPassword')"
            />
            <BaseInput
                v-model="form.confirmPassword"
                label="Confirm new password"
                type="password"
                autocomplete="new-password"
                :error="errors.confirmPassword"
                @update:model-value="clearError('confirmPassword')"
            />
        </form>
        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="saving"
                @click="model = false"
                >Cancel</BaseButton
            >
            <BaseButton
                class="flex-1"
                type="submit"
                :form="formId"
                :loading="saving"
                >Change password</BaseButton
            >
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { ErrorCode } from '@grocery-pos/contracts';
import api from '@/axios';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useAuthStore } from '@/stores/auth';
import { Color, useUIStore } from '@/stores/ui';
import { apiErrorCode, apiErrorMessages } from '@/utils/api-error';
import {
    type ChangePasswordDraft,
    toChangePasswordBody,
} from '@/utils/payloads';
import {
    confirmPasswordError,
    currentPasswordError,
    fieldErrors,
    PASSWORD_HINT,
    passwordError,
} from '@/utils/rules';
import {
    PASSWORD_CHANGED,
    PASSWORD_CHANGED_STAYED,
    WRONG_CURRENT_PASSWORD,
} from './change-password';

/**
 * The profile menu's "Change password" (#88): `PATCH /users/me/password`
 * for whoever is logged in, any role.
 *
 * - The fields are checked on submit with the API's rules (`utils/rules`);
 *   the confirmation is checked here only and never sent.
 * - A wrong current password is shown on that field; any other failure is
 *   a toast (#18). The dialog stays open until the save resolves.
 * - On success the user logs in again (product decision): the server keeps
 *   this session and ends the others, so this logs out through
 *   `requestLogout`, which lets a draft page ask first (#19) and shows the
 *   success notice on the login page.
 */
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const authStore = useAuthStore();
const uiStore = useUIStore();
const formId = useId();

const saving = ref(false);

/** Escape, the backdrop and Cancel cannot close it while it saves. */
const model = computed({
    get: () => props.modelValue,
    set: (value: boolean) => {
        if (!value && saving.value) return;
        emit('update:modelValue', value);
    },
});

const empty = (): ChangePasswordDraft => ({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
});

const form = ref<ChangePasswordDraft>(empty());
/** Why each field is refused, set on submit; cleared when it is edited. */
const errors = ref<Partial<Record<keyof ChangePasswordDraft, string>>>({});

// Opening or closing empties it: no password stays typed after a Cancel.
watch(
    () => props.modelValue,
    () => {
        form.value = empty();
        errors.value = {};
    },
);

function clearError(field: keyof ChangePasswordDraft) {
    const next = { ...errors.value };
    delete next[field];
    errors.value = next;
}

function formErrors(): Record<string, string> {
    const f = form.value;
    return fieldErrors({
        currentPassword: currentPasswordError(f.currentPassword),
        newPassword: passwordError(f.newPassword),
        confirmPassword: confirmPasswordError(f.newPassword, f.confirmPassword),
    });
}

async function save() {
    if (saving.value) return;
    errors.value = formErrors();
    if (Object.keys(errors.value).length) return;

    saving.value = true;
    try {
        await api.patch('/users/me/password', toChangePasswordBody(form.value));
    } catch (error) {
        if (apiErrorCode(error) === ErrorCode.USER_WRONG_PASSWORD) {
            errors.value = { currentPassword: WRONG_CURRENT_PASSWORD };
        } else {
            uiStore.queueMessage(
                Color.ERROR,
                apiErrorMessages(error, 'Could not change the password.'),
            );
        }
        return;
    } finally {
        saving.value = false;
    }

    model.value = false;
    const loggedOut = await authStore.requestLogout(PASSWORD_CHANGED);
    if (!loggedOut)
        uiStore.queueMessage(Color.SUCCESS, PASSWORD_CHANGED_STAYED);
}
</script>
