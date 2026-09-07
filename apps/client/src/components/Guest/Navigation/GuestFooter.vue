<template>
    <footer class="bg-[#075BAB] text-white text-sm px-6 sm:px-12 py-8 relative">
        <div class="flex justify-between items-center w-full py-4">
            <img :src="logo" alt="Grocery POS Logo" class="h-14 w-auto" />
            <router-link
                to="/login"
                class="rounded-xl bg-white text-[#075BAB] px-5 py-2.5 font-bold hover:bg-slate-100 transition-colors"
            >
                Get Started
            </router-link>
        </div>

        <div class="w-full h-px bg-white/40 my-4" />

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-8 mt-2">
            <div>
                <p class="font-bold mb-3">Contact us</p>
                <ul class="list-none p-0 m-0 space-y-2">
                    <li class="flex items-center gap-2">
                        <img
                            :src="facebook"
                            class="w-7 h-7 shrink-0"
                            alt="Facebook"
                        />
                        <a :href="facebook_link" class="text-white truncate">{{
                            facebook_link
                        }}</a>
                    </li>
                    <li class="flex items-center gap-2">
                        <img
                            :src="tiktok"
                            class="w-7 h-7 shrink-0"
                            alt="TikTok"
                        />
                        <a :href="tiktok_link" class="text-white truncate">{{
                            tiktok_link
                        }}</a>
                    </li>
                    <li class="flex items-center gap-2">
                        <img
                            :src="website"
                            class="w-7 h-7 shrink-0"
                            alt="Website"
                        />
                        <a :href="website_link" class="text-white truncate">{{
                            website_link
                        }}</a>
                    </li>
                    <li class="flex items-center gap-2">
                        <img
                            :src="contact_no"
                            class="w-7 h-7 shrink-0"
                            alt="Contact"
                        />
                        <a :href="contact_number" class="text-white">{{
                            contact_number
                        }}</a>
                    </li>
                </ul>
                <p class="font-bold mt-6 mb-2">Address</p>
                <span
                    >123 Commerce St., Business District<br />Metro City,
                    12345</span
                >
            </div>

            <div class="flex flex-col justify-between">
                <div>
                    <p class="font-bold mb-3">Pages</p>
                    <ul class="list-none p-0 m-0 space-y-2">
                        <li v-for="(page, index) in pages" :key="index">
                            <router-link
                                :to="page.to"
                                class="text-white hover:underline"
                            >
                                {{ page.name }}
                            </router-link>
                        </li>
                    </ul>
                </div>
                <p class="text-xs mt-6">
                    &copy; {{ new Date().getFullYear() }} — Copyright.
                    {{ version }}
                </p>
            </div>
        </div>

        <button
            type="button"
            class="absolute bottom-4 right-6 w-10 h-10 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
            @click="scrolltoTop"
        >
            <ArrowUp class="w-4 h-4" />
        </button>
    </footer>
</template>

<script setup lang="ts">
import { ArrowUp } from '@lucide/vue';
import version from '@/utils/version';
import logo from '@/assets/logo-white.svg';
import facebook from '@/assets/Socials/facebook.svg';
import tiktok from '@/assets/Socials/tiktok.svg';
import website from '@/assets/Socials/website.svg';
import contact_no from '@/assets/Socials/contact_no.svg';

const facebook_link = 'www.facebook.com/grocerypos';
const tiktok_link = 'www.tiktok.com/@grocerypos';
const website_link = 'www.grocerypos.example.com';
const contact_number = '+1 (555) 123-4567';

const scrolltoTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

const pages = [
    { name: 'Dashboard', to: '/admin' },
    { name: 'Products', to: '/admin/products' },
    { name: 'Support', to: '/login' },
];
</script>
