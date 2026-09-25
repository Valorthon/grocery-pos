<template>
    <img :src="src" alt="" v-bind="$attrs" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import bill1000 from '@/assets/Cash_Logo/1000-bill.png';
import bill500 from '@/assets/Cash_Logo/500-bill.png';
import bill200 from '@/assets/Cash_Logo/200-bill.png';
import bill100 from '@/assets/Cash_Logo/100-bill.png';
import bill50 from '@/assets/Cash_Logo/50-bill.png';
import bill20 from '@/assets/Cash_Logo/20-bill.png';
import coin20 from '@/assets/Cash_Logo/20-coin.png';
import coin10 from '@/assets/Cash_Logo/10-coin.png';
import coin5 from '@/assets/Cash_Logo/5-coin.png';
import coin1 from '@/assets/Cash_Logo/1-coin.png';
import coin025 from '@/assets/Cash_Logo/25-cents.png';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
    id: string;
}>();

const IMAGES: Record<string, string> = {
    '1000': bill1000,
    '500': bill500,
    '200': bill200,
    '100': bill100,
    '50': bill50,
    '20': bill20,
    'coin-20': coin20,
    'coin-10': coin10,
    'coin-5': coin5,
    'coin-1': coin1,
    'coin-25c': coin025,
};

const src = computed(() => IMAGES[props.id] ?? '');
</script>
