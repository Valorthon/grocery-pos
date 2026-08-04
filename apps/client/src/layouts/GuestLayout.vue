<template>
    <v-app>
        <!-- Hidden on /login via route meta -->
        <GuestAppbar v-if="!route.meta.hideAppBar" />

        <v-main>
            <router-view />
        </v-main>
        <GuestFooter v-if="!route.meta.hideFooter" />
    </v-app>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import GuestAppbar from '@/components/Guest/Navigation/GuestAppbar.vue';
import GuestFooter from '@/components/Guest/Navigation/GuestFooter.vue';
const route = useRoute();
</script>
