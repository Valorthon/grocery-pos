<template>
    <BaseModal
        :model-value="modelValue"
        title="Manager approval"
        max-width="26rem"
        :closable="!submitting"
        @update:model-value="close"
    >
        <form class="space-y-4" @submit.prevent="approve">
            <p class="text-sm text-slate-700">{{ summary }}</p>
            <p class="text-xs text-slate-500">
                {{
                    request?.action === OverrideAction.DISCOUNT
                        ? 'An admin must approve this discount.'
                        : 'An admin or supervisor must approve this action.'
                }}
                The cashier stays logged in.
            </p>
            <BaseInput
                id="override-manager-name"
                v-model="username"
                label="Manager username"
                autocomplete="off"
                :maxlength="STRING_LIMITS.USERNAME"
                :disabled="submitting"
            />
            <BaseInput
                id="override-manager-pin"
                v-model="pin"
                label="6-digit manager PIN"
                type="password"
                inputmode="numeric"
                autocomplete="off"
                :maxlength="OVERRIDE_PIN_LENGTH"
                :disabled="submitting"
            />
            <div class="grid grid-cols-3 gap-2" aria-label="Manager PIN keypad">
                <button
                    v-for="key in keys"
                    :key="key"
                    type="button"
                    class="min-h-11 min-w-11 rounded-lg border border-slate-300 text-base font-semibold focus-ring disabled:opacity-40"
                    :disabled="submitting"
                    :aria-label="
                        key === '⌫'
                            ? 'Delete last PIN digit'
                            : key === 'Clear'
                              ? 'Clear PIN'
                              : `PIN digit ${key}`
                    "
                    @click="press(key)"
                >
                    {{ key }}
                </button>
            </div>
            <p v-if="error" role="alert" class="text-sm text-red-600">
                {{ error }}
            </p>
            <button class="sr-only" type="submit" :disabled="!canApprove">
                Approve
            </button>
        </form>
        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="submitting"
                @click="close(false)"
                >Cancel</BaseButton
            >
            <BaseButton
                :loading="submitting"
                :disabled="!canApprove"
                @click="approve"
                >Approve action</BaseButton
            >
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
    OverrideAction,
    OVERRIDE_PIN_LENGTH,
    STRING_LIMITS,
    type ManagerOverrideRequest,
    type ManagerOverrideResponse,
} from '@grocery-pos/contracts';
import api from '@/axios';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { apiErrorText } from '@/utils/api-error';
import type { ApprovalRequest } from '@/composables/useManagerApproval';

const props = defineProps<{
    modelValue: boolean;
    request: ApprovalRequest | null;
    summary: string;
}>();
const emit = defineEmits<{
    'update:modelValue': [value: boolean];
    approved: [token: string];
    cancel: [];
}>();
const username = ref('');
const pin = ref('');
const error = ref('');
const submitting = ref(false);
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', '⌫'];
const canApprove = computed(
    () =>
        !submitting.value &&
        !!username.value.trim() &&
        /^[0-9]{6}$/.test(pin.value),
);
watch(
    () => props.modelValue,
    () => {
        username.value = '';
        pin.value = '';
        error.value = '';
    },
);
function close(open: boolean) {
    if (open || submitting.value) return;
    pin.value = '';
    username.value = '';
    emit('update:modelValue', false);
    emit('cancel');
}
function press(key: string) {
    if (key === 'Clear') pin.value = '';
    else if (key === '⌫') pin.value = pin.value.slice(0, -1);
    else if (pin.value.length < OVERRIDE_PIN_LENGTH) pin.value += key;
}
async function approve() {
    if (!canApprove.value || !props.request) return;
    submitting.value = true;
    error.value = '';
    try {
        const response = await api.post<ManagerOverrideResponse>(
            '/auth/override',
            {
                ...props.request,
                username: username.value.trim().toLowerCase(),
                pin: pin.value,
            } satisfies ManagerOverrideRequest,
        );
        pin.value = '';
        username.value = '';
        emit('approved', response.data.token);
    } catch (err) {
        pin.value = '';
        error.value = apiErrorText(
            err,
            'Manager approval failed. Please try again.',
        );
    } finally {
        submitting.value = false;
    }
}
</script>
