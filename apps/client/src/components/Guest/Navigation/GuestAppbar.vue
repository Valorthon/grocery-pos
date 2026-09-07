<template>
    <header
        class="bg-[#075BAB] h-[68px] flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30"
    >
        <div class="flex items-center">
            <img :src="logoPath" alt="Grocery POS" class="h-9 w-auto" />
        </div>

        <div class="flex items-center gap-3">
            <router-link
                to="/login"
                class="hidden sm:inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
            >
                <LogIn class="w-4 h-4" />
                Login
            </router-link>
        </div>
    </header>
</template>

<script setup lang="ts">
import { LogIn } from '@lucide/vue';
import logoPath from '@/assets/logo-white.svg';
</script>
