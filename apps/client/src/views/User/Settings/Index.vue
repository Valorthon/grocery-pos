<template>
    <div class="space-y-5">
        <PageCard title="Store Settings">
            <div class="p-5 space-y-4">
                <p class="text-sm text-slate-600">
                    Store identity appears on new on-screen receipts and closing
                    reports. Existing saved identities remain unchanged.
                </p>
                <p
                    v-if="settings.error"
                    role="alert"
                    class="text-sm text-red-700"
                >
                    {{ settings.error }}
                </p>
                <BaseButton
                    :disabled="saving || settings.loading"
                    @click="reload"
                    >Reload settings</BaseButton
                >
                <form class="space-y-4" @submit.prevent="save">
                    <BaseInput
                        v-for="field in identityFields"
                        :id="`settings-${field.key}`"
                        :key="field.key"
                        v-model="form[field.key]"
                        :label="field.label"
                        :maxlength="field.max"
                        :disabled="saving"
                    />
                    <BaseInput
                        id="settings-timezone"
                        v-model="form.timezone"
                        label="Store timezone (IANA)"
                        :maxlength="SETTINGS_LIMITS.TIMEZONE"
                        :disabled="saving"
                    />
                    <p class="text-xs text-slate-600">
                        Close all shifts and release all offline terminals
                        before changing timezone. This changes future
                        store-calendar views and expiry boundaries.
                    </p>
                    <BaseInput
                        id="settings-currency"
                        model-value="PHP"
                        label="Currency"
                        disabled
                    />
                    <p class="text-xs text-slate-600">
                        Amounts remain Philippine pesos. Every discount still
                        requires ADMIN PIN approval.
                    </p>
                    <BaseInput
                        id="settings-reorder"
                        v-model="reorderInput"
                        label="Default reorder level for new products (display units)"
                        inputmode="numeric"
                        :disabled="saving"
                    />
                    <p class="text-xs text-slate-600">
                        Existing product levels, including legacy defaults,
                        remain unchanged.
                    </p>
                    <p
                        v-if="saveError"
                        role="alert"
                        class="text-sm text-red-700"
                    >
                        {{ saveError }}
                    </p>
                    <p
                        v-if="notice"
                        role="status"
                        class="text-sm text-emerald-700"
                    >
                        {{ notice }}
                    </p>
                    <BaseButton
                        type="submit"
                        :disabled="saving || !settingsDirty"
                        >{{
                            saving ? 'Saving…' : 'Save store settings'
                        }}</BaseButton
                    >
                </form>
            </div>
        </PageCard>
        <PageCard title="This register">
            <div class="p-5 space-y-4">
                <BaseInput
                    id="settings-terminal"
                    v-model="laneInput"
                    label="Terminal / lane label"
                    :maxlength="SETTINGS_LIMITS.TERMINAL"
                    :disabled="saving"
                />
                <p class="text-xs text-slate-600">
                    Saved on this device. New shifts use this label; it does not
                    grant access or change an open shift.
                </p>
                <BaseButton
                    :disabled="saving || laneInput.trim() === terminalLabel"
                    @click="saveLane"
                    >Save device label</BaseButton
                >
            </div>
        </PageCard>
        <ConfirmDialog :request="request" @answer="answer" />
    </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
    SETTINGS_LIMITS,
    type StoreIdentity,
    type UpdateStoreSettingsRequest,
} from '@grocery-pos/contracts';
import PageCard from '@/components/ui/PageCard.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useSettingsStore } from '@/stores/settings';
import { useConfirm } from '@/composables/useConfirm';
import { useUnsavedDraftsGuard } from '@/composables/useDrafts';
import {
    initialSettings,
    terminalLabel,
    saveTerminalLabel,
} from '@/settings/presentation';
import { apiErrorText } from '@/utils/api-error';
const settings = useSettingsStore();
const form = ref({ ...initialSettings });
const baseline = ref(JSON.stringify(form.value));
const reorderInput = ref<string | number>(10);
const laneInput = ref(terminalLabel.value);
const saving = ref(false),
    saveError = ref(''),
    notice = ref('');
const { request, confirm, answer } = useConfirm();
const identityFields: {
    key: keyof StoreIdentity;
    label: string;
    max: number;
}[] = [
    { key: 'storeName', label: 'Store name', max: SETTINGS_LIMITS.STORE_NAME },
    {
        key: 'branchName',
        label: 'Branch name',
        max: SETTINGS_LIMITS.BRANCH_NAME,
    },
    { key: 'address', label: 'Address', max: SETTINGS_LIMITS.ADDRESS },
    {
        key: 'contactNumber',
        label: 'Contact number',
        max: SETTINGS_LIMITS.CONTACT,
    },
    { key: 'tin', label: 'TIN (optional)', max: SETTINGS_LIMITS.TIN },
    {
        key: 'receiptFooter',
        label: 'Receipt footer',
        max: SETTINGS_LIMITS.FOOTER,
    },
];
const settingsDirty = computed(
    () =>
        JSON.stringify(form.value) !== baseline.value ||
        String(reorderInput.value) !== String(form.value.defaultReorderLevel),
);
useUnsavedDraftsGuard({
    count: () =>
        settingsDirty.value || laneInput.value.trim() !== terminalLabel.value
            ? 1
            : 0,
    saving: () => saving.value,
    confirm,
});
let active = true;
onBeforeUnmount(() => {
    active = false;
});
function resetForm() {
    form.value = { ...settings.settings };
    baseline.value = JSON.stringify(form.value);
    reorderInput.value = form.value.defaultReorderLevel;
}
onMounted(async () => {
    await settings.refresh();
    if (active) resetForm();
});
async function reload() {
    if (saving.value || settings.loading) return;
    if (
        settingsDirty.value &&
        !(await confirm({
            title: 'Discard settings edits?',
            message: 'Reload saved settings and discard these edits?',
            confirmLabel: 'Reload',
        }))
    )
        return;
    await settings.refresh();
    if (active && !settings.error) {
        resetForm();
        saveError.value = '';
        notice.value = '';
    }
}
async function save() {
    if (saving.value || !settingsDirty.value) return;
    saveError.value = '';
    notice.value = '';
    const level = Number(reorderInput.value);
    if (
        !form.value.storeName.trim() ||
        identityFields.some(
            (field) => form.value[field.key].trim().length > field.max,
        ) ||
        !String(reorderInput.value).trim() ||
        !Number.isInteger(level) ||
        level < 0 ||
        level > SETTINGS_LIMITS.REORDER_LEVEL
    ) {
        saveError.value =
            'Enter a store name and a valid whole-number reorder default.';
        return;
    }
    try {
        const timezone = form.value.timezone.trim();
        if (timezone !== 'UTC' && !timezone.includes('/'))
            throw new Error('IANA timezone required');
        new Intl.DateTimeFormat('en', {
            timeZone: form.value.timezone.trim(),
        }).format();
    } catch {
        saveError.value = 'Enter a valid IANA timezone.';
        return;
    }
    const body: UpdateStoreSettingsRequest = {
        version: form.value.version,
        timezone: form.value.timezone.trim(),
        defaultReorderLevel: level,
    };
    for (const field of identityFields)
        body[field.key] = form.value[field.key].trim();
    saving.value = true;
    try {
        if ((await settings.save(body)) && active) {
            resetForm();
            notice.value = 'Store settings saved.';
        }
    } catch (cause) {
        if (active) saveError.value = apiErrorText(cause);
    } finally {
        if (active) saving.value = false;
    }
}
function saveLane() {
    notice.value = '';
    saveError.value = '';
    if (saveTerminalLabel(laneInput.value)) {
        laneInput.value = terminalLabel.value;
        notice.value = 'Device label saved for the next shift.';
    } else
        saveError.value =
            'Could not save the device label. Check the label and browser storage.';
}
</script>
