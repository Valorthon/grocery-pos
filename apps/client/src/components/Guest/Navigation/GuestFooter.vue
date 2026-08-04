<template>
    <v-footer
        color="#075BAB"
        class="text-caption text-white d-flex flex-column justify-space-between px-6 px-sm-12 py-6"
    >
        <!-- Logo and Button -->
        <div class="d-flex justify-space-between align-center w-100 py-4">
            <img :src="logo" alt="Grocery POS Logo" width="145" height="60" />
            <v-btn class="rounded-xl inquire-btn px-5" to="/login"
                >Get Started</v-btn
            >
        </div>

        <!-- Divider -->
        <v-divider
            :thickness="1"
            color="white"
            class="pa-1"
            style="width: 100%"
        />

        <!-- Contacts + Pages -->
        <v-row class="w-100 mt-2" no-gutters>
            <!-- Contact us -->
            <v-col cols="12" sm="6" class="mb-6 mb-sm-0">
                <p class="font-weight-bold mb-3">Contact us</p>
                <ul class="no-bullets">
                    <li class="d-flex align-center ga-2 mb-2">
                        <v-img
                            :src="facebook"
                            width="30"
                            height="30"
                            style="flex: 0 0 30px"
                        />
                        <a :href="facebook_link" class="links text-truncate">{{
                            facebook_link
                        }}</a>
                    </li>
                    <li class="d-flex align-center ga-2 mb-2">
                        <v-img
                            :src="tiktok"
                            width="30"
                            height="30"
                            style="flex: 0 0 30px"
                        />
                        <a :href="tiktok_link" class="links text-truncate">{{
                            tiktok_link
                        }}</a>
                    </li>
                    <li class="d-flex align-center ga-2 mb-2">
                        <v-img
                            :src="website"
                            width="30"
                            height="30"
                            style="flex: 0 0 30px"
                        />
                        <a :href="website_link" class="links text-truncate">{{
                            website_link
                        }}</a>
                    </li>
                    <li class="d-flex align-center ga-2">
                        <v-img
                            :src="contact_no"
                            width="30"
                            height="30"
                            style="flex: 0 0 30px"
                        />
                        <a :href="contact_number" class="links">{{
                            contact_number
                        }}</a>
                    </li>
                </ul>
                <p class="font-weight-bold mt-6 mb-2">Address</p>
                <span
                    >123 Commerce St., Business District<br />Metro City,
                    12345</span
                >
            </v-col>

            <!-- Pages + Copyright -->
            <v-col
                cols="12"
                sm="6"
                class="d-flex flex-column justify-space-between"
            >
                <div>
                    <p class="font-weight-bold mb-3">Pages</p>
                    <ul class="no-bullets">
                        <li
                            v-for="(page, index) in pages"
                            :key="index"
                            class="mb-2"
                        >
                            <router-link
                                :to="page.to"
                                class="links text-decoration-none"
                                >{{ page.name }}</router-link
                            >
                        </li>
                    </ul>
                </div>
                <p class="text-caption mt-6">
                    &copy; {{ new Date().getFullYear() }} — Copyright. &nbsp;{{
                        version
                    }}
                </p>
            </v-col>
        </v-row>

        <!-- Scroll to top -->
        <v-btn
            icon="mdi-arrow-up"
            style="position: absolute; bottom: 16px; right: 24px"
            @click="scrolltoTop"
        />
    </v-footer>
</template>

<script setup lang="ts">
import version from '@/utils/version';
import logo from '@/assets/logo-white.svg';
import { ref } from 'vue';
import facebook from '@/assets/Socials/facebook.svg';
import tiktok from '@/assets/Socials/tiktok.svg';
import website from '@/assets/Socials/website.svg';
import contact_no from '@/assets/Socials/contact_no.svg';

const facebook_link = ref('www.facebook.com/grocerypos');
const tiktok_link = ref('www.tiktok.com/@grocerypos');
const website_link = ref('www.grocerypos.example.com');
const contact_number = ref('+1 (555) 123-4567');

const scrolltoTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

const pages = [
    { name: 'Dashboard', to: '/admin' },
    { name: 'Products', to: '/admin/products' },
    { name: 'Sales', to: '/admin/sales' },
    { name: 'Support', to: '/login' },
];
</script>

<style scoped>
.inquire-btn {
    color: #075bab;
}

.v-divider {
    opacity: 1 !important;
}

.links {
    color: white;
}

.no-bullets {
    list-style: none;
    padding-left: 0;
    margin: 0;
}
</style>
