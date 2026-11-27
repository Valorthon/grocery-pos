<template>
    <PageFrame narrow>
        <PageCard heading="Store identity">
            <div class="p-5 space-y-4">
                <p class="text-sm text-slate-600">
                    Store identity appears on new on-screen sale summaries and
                    closing reports. Existing saved identities remain unchanged.
                </p>
                <p class="text-sm text-slate-600" data-testid="non-vat-notice">
                    {{ NON_VAT_NOTICE }}
                </p>
                <p
                    v-if="settings.error"
                    role="alert"
                    class="text-sm text-red-700"
                >
                    {{ settings.error }}
                </p>
                <BaseButton
                    :disabled="saving || loadingForm || settings.loading"
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
                        :disabled="saving || loadingForm"
                    />
                    <BaseInput
                        id="settings-timezone"
                        v-model="form.timezone"
                        label="Store timezone (IANA)"
                        :maxlength="SETTINGS_LIMITS.TIMEZONE"
                        :disabled="saving || loadingForm"
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
                        id="settings-low-stock"
                        v-model="reorderInput"
                        label="Default low stock level for new products (display units)"
                        inputmode="numeric"
                        :disabled="saving || loadingForm"
                    />
                    <p class="text-xs text-slate-600">
                        Existing product levels, including legacy defaults,
                        remain unchanged.
                    </p>
                    <BaseInput
                        id="settings-expiry-days"
                        v-model="expiryInput"
                        label="Expiry alert window (days)"
                        inputmode="numeric"
                        :disabled="saving || loadingForm"
                    />
                    <p class="text-xs text-slate-600">
                        The dashboard and the Inventories expiring list flag
                        batches expiring within this many days, or already
                        expired ({{ SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_MIN }}–{{
                            SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_MAX
                        }}).
                    </p>
                    <p
                        v-if="saveError"
                        role="alert"
                        class="text-sm text-red-700"
                    >
                        {{ saveError }}
                    </p>
                    <BaseButton
                        type="submit"
                        :disabled="saving || loadingForm || !settingsDirty"
                        >{{
                            saving ? 'Saving…' : 'Save store settings'
                        }}</BaseButton
                    >
                </form>
            </div>
        </PageCard>
        <PageCard heading="This terminal">
            <div class="p-5 space-y-4" data-testid="this-terminal">
                <p class="text-sm text-slate-600">
                    Saved in this PC's browser only; set it on each terminal.
                </p>
                <p class="text-sm text-slate-600" data-testid="device-address">
                    This device's address:
                    <span class="font-medium text-slate-900">{{
                        deviceAddress
                    }}</span>
                </p>
                <p
                    v-if="ephemeral"
                    role="alert"
                    class="text-sm text-amber-800"
                    data-testid="ephemeral-warning"
                >
                    This looks like a Guest or Incognito window. The terminal
                    label and any offline cash sales waiting to sync are lost
                    when it closes. Use a normal browser window.
                </p>
                <p class="text-sm text-slate-600" data-testid="terminal-state">
                    Current label:
                    <span class="font-medium text-slate-900">{{
                        savedTerminalLabel || 'Not set'
                    }}</span>
                </p>
                <form class="space-y-4" @submit.prevent="saveLane">
                    <BaseInput
                        id="settings-terminal"
                        v-model="laneInput"
                        label="Terminal / lane label"
                        placeholder="Not set"
                        :maxlength="SETTINGS_LIMITS.TERMINAL"
                        :error="laneError"
                        :disabled="saving || loadingForm"
                        @update:model-value="laneError = ''"
                    />
                    <p class="text-xs text-slate-600">
                        New shifts use this label; it does not grant access or
                        change an open shift.
                    </p>
                    <BaseButton
                        type="submit"
                        :disabled="saving || loadingForm || !laneDirty"
                        >Save terminal label</BaseButton
                    >
                </form>
            </div>
        </PageCard>
        <PageCard heading="Terminals seen">
            <div class="p-5 space-y-3" data-testid="terminals-seen">
                <p class="text-sm text-slate-600">
                    Labels used by shifts and offline mode, newest first
                    (read-only, at most {{ TERMINALS_SEEN_LIMIT }}).
                </p>
                <p v-if="seenLoading" class="text-sm text-slate-600">
                    Loading…
                </p>
                <div v-else-if="seenError" class="space-y-2">
                    <p role="alert" class="text-sm text-red-700">
                        {{ seenError }}
                    </p>
                    <BaseButton @click="loadSeen">Retry</BaseButton>
                </div>
                <p v-else-if="seen.length === 0" class="text-sm text-slate-600">
                    No terminals yet.
                </p>
                <ul v-else class="divide-y divide-slate-200 text-sm">
                    <li
                        v-for="row in seen"
                        :key="row.label"
                        class="py-2 flex flex-wrap gap-x-3"
                    >
                        <span class="font-medium text-slate-900">{{
                            row.label
                        }}</span>
                        <span class="text-slate-600"
                            >Last seen
                            {{ formatStoreDateTime(row.lastSeenAt) }}</span
                        >
                        <span class="text-slate-600"
                            >{{ row.shifts }}
                            {{ row.shifts === 1 ? 'shift' : 'shifts' }} ·
                            {{ row.offlineLeases }} offline
                            {{
                                row.offlineLeases === 1 ? 'session' : 'sessions'
                            }}</span
                        >
                    </li>
                </ul>
            </div>
        </PageCard>
        <ConfirmDialog :request="request" @answer="answer" />
    </PageFrame>
</template>
<script setup lang="ts">
import { NON_VAT_NOTICE } from '@/utils/tax-notice';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    SETTINGS_LIMITS,
    TERMINALS_SEEN_LIMIT,
    type TerminalSeen,
    type TerminalsSeenResponse,
    type StoreIdentity,
    type UpdateStoreSettingsRequest,
} from '@grocery-pos/contracts';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useSettingsStore } from '@/stores/settings';
import { Color, useUIStore } from '@/stores/ui';
import api from '@/axios';
import { formatStoreDateTime } from '@/utils/datetime';
import { useConfirm } from '@/composables/useConfirm';
import { useUnsavedDraftsGuard } from '@/composables/useDrafts';
import {
    initialSettings,
    looksEphemeralBrowser,
    savedTerminalLabel,
    saveTerminalLabel,
    validExpiryAlertDays,
} from '@/settings/presentation';
import { apiErrorText } from '@/utils/api-error';
const settings = useSettingsStore();
const form = ref({ ...initialSettings });
const baseline = ref(JSON.stringify(form.value));
const reorderInput = ref<string | number>(10);
const expiryInput = ref<string | number>(initialSettings.expiryAlertDays);
const ui = useUIStore();
const laneInput = ref(savedTerminalLabel.value);
const laneError = ref('');
const laneDirty = computed(
    () => laneInput.value.trim() !== savedTerminalLabel.value,
);
const ephemeral = ref(false);
const seen = ref<TerminalSeen[]>([]);
const seenLoading = ref(true);
const seenError = ref('');
let seenRequest = 0;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const deviceAddress = LOOPBACK.has(window.location.hostname)
    ? `${window.location.host} (the main PC)`
    : window.location.host;
const loadingForm = ref(true);
const saving = ref(false),
    saveError = ref('');
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
        label: 'Sale summary footer',
        max: SETTINGS_LIMITS.FOOTER,
    },
];
const settingsDirty = computed(
    () =>
        JSON.stringify(form.value) !== baseline.value ||
        String(reorderInput.value) !== String(form.value.defaultReorderLevel) ||
        String(expiryInput.value) !== String(form.value.expiryAlertDays),
);
useUnsavedDraftsGuard({
    count: () => (settingsDirty.value || laneDirty.value ? 1 : 0),
    saving: () => saving.value,
    confirm,
});
let active = true;
let stopOwnerWait: (() => void) | undefined;
onBeforeUnmount(() => {
    active = false;
    stopOwnerWait?.();
});
/**
 * On a fresh page load this view mounts before the layout sets the settings
 * owner, so a refresh now would return early and leave the defaults
 * (version 0) in the form (#139). Wait for the owner first.
 */
function ownerKnown(): Promise<void> {
    if (settings.owner) return Promise.resolve();
    return new Promise((resolve) => {
        stopOwnerWait = watch(
            () => settings.owner,
            (owner) => {
                if (!owner) return;
                stopOwnerWait?.();
                resolve();
            },
        );
    });
}
function resetForm() {
    form.value = { ...settings.settings };
    baseline.value = JSON.stringify(form.value);
    reorderInput.value = form.value.defaultReorderLevel;
    expiryInput.value = form.value.expiryAlertDays;
}
async function loadSeen() {
    const request = ++seenRequest;
    seenLoading.value = true;
    seenError.value = '';
    try {
        const { data } =
            await api.get<TerminalsSeenResponse>('/shifts/terminals');
        if (active && request === seenRequest) seen.value = data.terminals;
    } catch (cause) {
        if (active && request === seenRequest)
            seenError.value = apiErrorText(cause);
    } finally {
        if (active && request === seenRequest) seenLoading.value = false;
    }
}
onMounted(() => {
    void looksEphemeralBrowser().then((value) => {
        if (active) ephemeral.value = value;
    });
});
onMounted(async () => {
    await ownerKnown();
    if (!active) return;
    await settings.refresh();
    if (active) {
        resetForm();
        loadingForm.value = false;
        void loadSeen();
    }
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
    loadingForm.value = true;
    await settings.refresh();
    if (active) loadingForm.value = false;
    if (active && !settings.error) {
        resetForm();
        saveError.value = '';
    }
}
async function save() {
    if (saving.value || loadingForm.value || !settingsDirty.value) return;
    saveError.value = '';
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
            'Enter a store name and a valid whole-number low stock default.';
        return;
    }
    const expiryDays = Number(expiryInput.value);
    if (
        !String(expiryInput.value).trim() ||
        !validExpiryAlertDays(expiryDays)
    ) {
        saveError.value = `Enter a whole number of expiry alert days from ${SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_MIN} to ${SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_MAX}.`;
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
        expiryAlertDays: expiryDays,
    };
    for (const field of identityFields)
        body[field.key] = form.value[field.key].trim();
    saving.value = true;
    try {
        if ((await settings.save(body)) && active) {
            resetForm();
            ui.queueMessage(Color.SUCCESS, 'Store settings saved.');
        }
    } catch (cause) {
        if (active) saveError.value = apiErrorText(cause);
    } finally {
        if (active) saving.value = false;
    }
}
function saveLane() {
    laneError.value = '';
    const label = laneInput.value.trim();
    if (!label) {
        laneError.value = 'Enter a label for this terminal.';
        return;
    }
    if (label.length > SETTINGS_LIMITS.TERMINAL) {
        laneError.value = `Use at most ${SETTINGS_LIMITS.TERMINAL} characters.`;
        return;
    }
    if (saveTerminalLabel(label)) {
        laneInput.value = savedTerminalLabel.value;
        ui.queueMessage(Color.SUCCESS, 'Terminal label saved.');
    } else
        laneError.value =
            "Couldn't save the label in this browser's storage. Check that the browser allows site data, then try again.";
}
</script>
