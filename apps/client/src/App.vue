<template>
    <RouterView />
    <Toast />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
import Toast from './components/Toast.vue';
</script>
