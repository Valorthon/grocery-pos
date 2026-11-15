<template>
    <RouterView />
    <Toast />
    <ClientOutdatedDialog />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
import Toast from './components/Toast.vue';
import ClientOutdatedDialog from './components/ClientOutdatedDialog.vue';
</script>
