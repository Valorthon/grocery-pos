<template>
    <BaseModal
        v-model="model"
        :closable="!saving"
        title="Save Adjustment Info"
        max-width="28rem"
    >
        <BaseInput
            v-model="formData.description"
            label="Description"
            :maxlength="STRING_LIMITS.DESCRIPTION"
            :error="errors.description"
        />
        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="saving"
                @click="model = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" :loading="saving" @click="handleSubmit">
                <Save class="w-4 h-4" />
                Save
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Save } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { Color, useUIStore } from '@/stores/ui';
import { apiErrorMessages } from '@/utils/api-error';
import { STRING_LIMITS } from '@grocery-pos/contracts';
import { SaveForm } from './dto';
import { adjustmentSaveErrors } from './validation';

const props = defineProps<{
    modelValue: boolean;
    /**
     * Saves the draft; resolves true once it is saved. The parent reports
     * its own failures (toasts) and resolves false. The dialog stays open,
     * busy, until this settles, and closes only on success (issue #18).
     */
    save: (payload: SaveForm) => Promise<boolean>;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
}>();

const uiStore = useUIStore();
const saving = ref(false);

// Escape, the backdrop and Cancel cannot close it mid-save.
const model = computed({
    get: () => props.modelValue,
    set: (val) => {
        if (!val && saving.value) return;
        emit('update:modelValue', val);
    },
});

const formData = reactive<SaveForm>({ description: '' });
const errors = ref<Record<string, string>>({});

async function handleSubmit() {
    if (saving.value) return;
    errors.value = adjustmentSaveErrors(formData);
    if (Object.keys(errors.value).length) return;

    saving.value = true;
    let saved = false;
    try {
        saved = await props.save({ ...formData });
    } catch (error) {
        // A save that threw instead of reporting: never fail silently.
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, 'Error saving. Try again.'),
        );
    } finally {
        saving.value = false;
    }
    if (!saved) return;
    formData.description = '';
    model.value = false;
}
</script>
