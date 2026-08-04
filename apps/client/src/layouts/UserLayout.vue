<template>
    <v-app>
        <UserAppbar @toggle-drawer="drawer = !drawer" />
        <UserSidebar v-model="drawer" />

        <v-main class="bg-grey-lighten-4">
            <router-view />
        </v-main>
    </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import UserAppbar from '@/components/User/Navigation/UserAppbar.vue';
import UserSidebar from '@/components/User/Navigation/UserSidebar.vue';

const drawer = ref(true);
</script>
