<template>
    <div ref="rootRef" class="relative">
        <div @click="toggle">
            <slot name="trigger" :open="modelValue" :toggle="toggle" />
        </div>

        <Transition
            enter-active-class="transition duration-100 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition duration-100 ease-in"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
        >
            <div
                v-if="modelValue"
                :class="[
                    'absolute z-50 mt-2 rounded-2xl bg-white shadow-xl border border-slate-200 p-1.5',
                    align === 'right' ? 'right-0' : 'left-0',
                    widthClass,
                ]"
                @click="emit('update:modelValue', false)"
            >
                <slot name="menu" :close="close" />
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        align?: 'left' | 'right';
        widthClass?: string;
    }>(),
    {
        align: 'right',
        widthClass: 'w-56',
    },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const rootRef = ref<HTMLElement | null>(null);

function toggle() {
    emit('update:modelValue', !props.modelValue);
}

function close() {
    emit('update:modelValue', false);
}

function onClickOutside(event: MouseEvent) {
    if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
        emit('update:modelValue', false);
    }
}

onMounted(() => {
    document.addEventListener('mousedown', onClickOutside);
});

onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onClickOutside);
});
</script>
