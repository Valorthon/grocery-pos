<template>
    <div class="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-paper">
        <!--
            Left: market panel. A Fresh market gradient (tokens, scoped CSS)
            with CSS/SVG produce artwork; the optional self-hosted photo
            (#26, README "Login hero photo") sits over it and simply does not
            show when the file is missing.
        -->
        <div
            data-testid="login-hero"
            class="hidden md:flex relative overflow-hidden hero-gradient text-surface"
        >
            <div
                data-testid="login-hero-photo"
                class="absolute inset-0 bg-cover bg-center"
                :style="{ backgroundImage: `url('${LOGIN_HERO_URL}')` }"
            />
            <div class="absolute inset-0 hero-overlay" />
            <svg
                data-testid="login-hero-art"
                class="hidden lg:block absolute -top-6 -right-6 w-72 h-72 text-leaf-400 opacity-60"
                viewBox="0 0 200 200"
                fill="none"
                aria-hidden="true"
                focusable="false"
            >
                <!-- Basket of produce: leaf, citrus and a crate. -->
                <circle cx="70" cy="92" r="30" class="fill-citrus-400" />
                <path
                    d="M70 62c4-10 12-14 20-14-2 9-9 14-20 14z"
                    fill="currentColor"
                />
                <circle cx="128" cy="98" r="24" class="fill-citrus-500" />
                <path
                    d="M104 70c18-26 52-28 70-18-14 4-26 14-34 30-12-6-24-10-36-12z"
                    fill="currentColor"
                />
                <rect
                    x="30"
                    y="112"
                    width="140"
                    height="64"
                    rx="10"
                    class="fill-leaf-800"
                />
                <path
                    d="M30 134h140M30 156h140M64 112v64M100 112v64M136 112v64"
                    stroke="currentColor"
                    stroke-width="4"
                />
            </svg>
            <div class="relative z-10 flex flex-col justify-between p-10 pb-14">
                <p
                    class="inline-flex self-start items-center gap-2 rounded-full bg-leaf-800 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-leaf-100"
                >
                    Fresh market point of sale
                </p>
                <!-- Scrim: keeps AA over any photo (#168). -->
                <div
                    data-testid="login-hero-text"
                    class="rounded-card bg-leaf-950/85 p-6"
                >
                    <p class="font-bold mb-3 hero-title">
                        Fresh stock,<br />fast checkout.
                    </p>
                    <p class="font-medium text-leaf-100 max-w-sm">
                        Sales, shifts and inventory for your grocery, in one
                        place.
                    </p>
                </div>
            </div>
        </div>

        <!-- Right: form panel, on the same paper background as the app. -->
        <div class="flex items-center justify-center p-6">
            <div class="w-full max-w-md">
                <router-link
                    to="/"
                    class="inline-flex mb-8 rounded-control focus-ring"
                >
                    <img
                        :src="logo"
                        alt="Grocery POS home"
                        class="h-14 w-auto"
                    />
                </router-link>

                <div class="mb-8">
                    <h1 class="text-2xl font-bold text-ink">Welcome back</h1>
                    <p class="mt-1 text-muted font-medium">
                        Log in with your store account to open your register or
                        dashboard.
                    </p>
                </div>

                <form
                    class="rounded-card border border-line bg-surface p-6"
                    @submit.prevent="handleLogin"
                >
                    <label for="login-username" :class="FIELD_LABEL"
                        >Username</label
                    >
                    <div class="relative mb-4">
                        <span
                            :class="[
                                'absolute left-3.5 top-1/2 -translate-y-1/2',
                                FIELD_ICON,
                            ]"
                        >
                            <UserIcon class="w-5 h-5" />
                        </span>
                        <input
                            id="login-username"
                            v-model="form.username"
                            type="text"
                            name="username"
                            autocomplete="username"
                            autocapitalize="none"
                            spellcheck="false"
                            placeholder="e.g. juan"
                            :disabled="loading"
                            :class="[FIELD_BASE, FIELD_OK, 'pl-11 pr-4']"
                        />
                    </div>

                    <label for="login-password" :class="FIELD_LABEL"
                        >Password</label
                    >
                    <div class="relative mb-2">
                        <span
                            :class="[
                                'absolute left-3.5 top-1/2 -translate-y-1/2',
                                FIELD_ICON,
                            ]"
                        >
                            <Lock class="w-5 h-5" />
                        </span>
                        <input
                            id="login-password"
                            v-model="form.password"
                            :type="showPassword ? 'text' : 'password'"
                            name="password"
                            autocomplete="current-password"
                            placeholder="••••••••"
                            :disabled="loading"
                            :class="[
                                FIELD_BASE,
                                FIELD_OK,
                                'pl-11 pr-12 min-h-11',
                            ]"
                        />
                        <button
                            type="button"
                            class="absolute right-0.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-11 h-11 rounded-control text-muted hover:text-ink focus-ring"
                            :aria-label="
                                showPassword ? 'Hide password' : 'Show password'
                            "
                            @click="showPassword = !showPassword"
                        >
                            <EyeOff v-if="showPassword" class="w-5 h-5" />
                            <Eye v-else class="w-5 h-5" />
                        </button>
                    </div>

                    <p
                        class="mb-5 text-sm text-muted"
                        data-testid="forgot-password"
                    >
                        Forgot your password? Ask an admin to reset it.
                    </p>

                    <div
                        v-if="errorMsg"
                        role="alert"
                        data-testid="login-error"
                        class="mb-4 px-4 py-3 rounded-control bg-danger-bg border border-danger-border text-danger-fg text-sm font-medium"
                    >
                        {{ errorMsg }}
                    </div>

                    <BaseButton
                        type="submit"
                        block
                        size="lg"
                        :loading="loading"
                    >
                        Log in
                        <ArrowRight class="w-4 h-4" />
                    </BaseButton>
                </form>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight, Eye, EyeOff, Lock, User as UserIcon } from '@lucide/vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import {
    FIELD_BASE,
    FIELD_ICON,
    FIELD_LABEL,
    FIELD_OK,
} from '@/components/ui/field-style';
import { useAuthStore } from '@/stores/auth';
import { homeRouteFor } from '@/router/access';
import { LOGIN_HERO_URL } from '@/constant';
import logo from '@/assets/logo-icon.svg';
import { loginErrorMessage } from './login-error';

const router = useRouter();
const authStore = useAuthStore();
const loading = ref(false);
const showPassword = ref(false);
const errorMsg = ref('');

const form = reactive({ username: '', password: '' });

const handleLogin = async () => {
    if (!form.username || !form.password) {
        errorMsg.value = 'Username and password are required.';
        return;
    }

    loading.value = true;
    errorMsg.value = '';

    try {
        await authStore.login(form.username, form.password);
        const home = homeRouteFor(authStore.user?.roles ?? []);
        if (home.name === 'Login') {
            // No role opens any page: do not stay half logged in.
            await authStore.logout();
            errorMsg.value = 'This account has no access to the app.';
            return;
        }
        void router.push(home);
    } catch (err) {
        errorMsg.value = loginErrorMessage(err);
    } finally {
        loading.value = false;
    }
};
</script>

<!--
    Static styles live here, not in inline style attributes: the nginx CSP has no
    style-src 'unsafe-inline' (#29). :style bindings are fine (Vue sets them
    through the CSSOM).
-->
<style scoped>
/* Fresh market tokens only (#168): no raw colours on the login page. */
.hero-gradient {
    background-color: var(--color-leaf-900);
    background-image: linear-gradient(
        160deg,
        var(--color-leaf-700) 0%,
        var(--color-leaf-950) 100%
    );
}

.hero-overlay {
    background: linear-gradient(
        160deg,
        color-mix(in srgb, var(--color-leaf-950) 55%, transparent) 0%,
        color-mix(in srgb, var(--color-leaf-950) 30%, transparent) 100%
    );
}

.hero-title {
    line-height: 1.3;
    font-size: clamp(1.8rem, 3.5vw, 2.8rem);
}
</style>
