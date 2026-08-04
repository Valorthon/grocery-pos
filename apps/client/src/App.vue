<template>
    <RouterView />
    <Toast />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
import Toast from './components/Toast.vue';
</script>

<style>
/*
  Add this in index.html <head>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
*/

:root {
    --v-font-family: 'Poppins', sans-serif;
}

body,
.v-application {
    font-family: 'Poppins', sans-serif !important;
}
</style>
