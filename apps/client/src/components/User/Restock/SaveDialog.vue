<template>
    <BaseModal v-model="model" title="Save Restock Info" max-width="28rem">
        <BaseInput
            v-model="formData.description"
            label="Description"
            :maxlength="STRING_LIMITS.DESCRIPTION"
            :error="errors.description"
        />
        <template #footer>
            <BaseButton variant="outline" @click="model = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" @click="handleSubmit">
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
import { STRING_LIMITS } from '@grocery-pos/contracts';
import { SaveForm } from './dto';
import { restockSaveErrors } from './validation';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'save', payload: SaveForm): void;
}>();

const model = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const formData = reactive<SaveForm>({ description: '' });
const errors = ref<Record<string, string>>({});

function handleSubmit() {
    errors.value = restockSaveErrors(formData);
    if (Object.keys(errors.value).length) return;
    emit('save', { ...formData });
    model.value = false;
    formData.description = '';
}
</script>
