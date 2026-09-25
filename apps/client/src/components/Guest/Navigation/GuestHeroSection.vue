<template>
    <section
        class="relative flex items-center min-h-[70vh] bg-cover bg-center"
        :style="{
            backgroundColor: '#0a303c',
            backgroundImage: `url('${LOGIN_HERO_URL}'), linear-gradient(90deg, #0a303c 0%, #11606f 100%)`,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        }"
    >
        <div
            class="absolute inset-0"
            style="
                background: linear-gradient(
                    90deg,
                    rgba(10, 48, 60, 0.88) 15%,
                    rgba(10, 48, 60, 0.3) 50%
                );
            "
        />

        <div class="relative z-10 max-w-7xl mx-auto w-full px-6 sm:px-10 py-16">
            <h1
                class="text-white font-extrabold leading-tight mb-4"
                style="font-size: clamp(2.2rem, 5vw, 3.4rem); line-height: 1.1"
            >
                Efficient Store Management
            </h1>

            <p class="text-white/80 text-base mb-8 max-w-xl">
                Manage inventory, process sales, and track restocks — all in one
                modern POS solution built for grocery businesses.
            </p>

            <router-link
                to="/login"
                class="inline-flex items-center justify-center bg-white text-slate-900 font-bold rounded-xl px-8 py-3 min-w-[180px] hover:bg-slate-100 transition-colors"
            >
                Get Started
            </router-link>
        </div>
    </section>
</template>

<script setup lang="ts">
import { LOGIN_HERO_URL } from '@/constant';
</script>
