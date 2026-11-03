<template>
    <BaseModal
        :model-value="!!user"
        title="Manager PIN"
        max-width="26rem"
        :closable="!saving"
        @update:model-value="close"
    >
        <div class="space-y-4">
            <p class="text-sm text-slate-700">
                Set a new manager PIN for {{ user?.name }}. The current PIN is
                never shown. Resetting or removing it invalidates their pending
                approvals.
            </p>
            <BaseInput
                v-model="pin"
                label="New 6-digit PIN"
                type="password"
                inputmode="numeric"
                autocomplete="new-password"
                :maxlength="OVERRIDE_PIN_LENGTH"
                :disabled="saving"
            />
            <p v-if="error" role="alert" class="text-sm text-red-600">
                {{ error }}
            </p>
            <ConfirmDialog :request="confirmRequest" @answer="answerConfirm" />
        </div>
        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="saving"
                @click="close(false)"
                >Cancel</BaseButton
            >
            <BaseButton variant="danger" :disabled="saving" @click="save(null)"
                >Remove PIN</BaseButton
            >
            <BaseButton :loading="saving" :disabled="!valid" @click="save(pin)"
                >Set PIN</BaseButton
            >
        </template>
    </BaseModal>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useConfirm } from '@/composables/useConfirm';
import {
    OVERRIDE_PIN_LENGTH,
    type UserView,
    type SetOverridePinRequest,
} from '@grocery-pos/contracts';
import api from '@/axios';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { apiErrorText } from '@/utils/api-error';
import { Color, useUIStore } from '@/stores/ui';
const props = defineProps<{ user: UserView | null }>();
const emit = defineEmits<{ close: [] }>();
const {
    request: confirmRequest,
    answer: answerConfirm,
    confirm,
} = useConfirm();
const pin = ref('');
const saving = ref(false);
const error = ref('');
const ui = useUIStore();
const valid = computed(() => !saving.value && /^[0-9]{6}$/.test(pin.value));
watch(
    () => props.user,
    () => {
        pin.value = '';
        error.value = '';
    },
);
function close(open: boolean) {
    if (!open && !saving.value) {
        pin.value = '';
        emit('close');
    }
}
async function save(value: string | null) {
    if (!props.user || saving.value || (value !== null && !valid.value)) return;
    if (
        !(await confirm({
            title: value === null ? 'Remove manager PIN?' : 'Set manager PIN?',
            message: `${value === null ? 'Remove' : 'Replace'} the PIN for ${props.user.name}? Pending approvals will be invalidated.`,
            confirmLabel: value === null ? 'Remove PIN' : 'Set PIN',
            danger: value === null,
        }))
    )
        return;
    saving.value = true;
    try {
        await api.patch(`/users/${props.user._id}/override-pin`, {
            pin: value,
        } satisfies SetOverridePinRequest);
        pin.value = '';
        ui.queueMessage(
            Color.SUCCESS,
            value === null ? 'Manager PIN removed' : 'Manager PIN updated',
        );
        emit('close');
    } catch (err) {
        error.value = apiErrorText(err, 'Could not update manager PIN');
    } finally {
        saving.value = false;
    }
}
</script>
