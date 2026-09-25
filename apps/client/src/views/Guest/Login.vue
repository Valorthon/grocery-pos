<template>
    <div class="min-h-screen grid grid-cols-1 md:grid-cols-2">
        <!--
            Left: image panel. The photo is self-hosted (#26) and not in the
            repo (README, "Login hero photo"); the gradient under it keeps
            the panel intentional when the file is missing.
        -->
        <div
            data-testid="login-hero"
            class="hidden md:flex items-start relative bg-cover bg-center"
            :style="{
                backgroundColor: '#0a303c',
                backgroundImage: `url('${LOGIN_HERO_URL}'), linear-gradient(160deg, #11606f 0%, #0a303c 100%)`,
            }"
        >
            <div
                class="absolute inset-0"
                style="
                    background: linear-gradient(
                        160deg,
                        rgba(10, 48, 60, 0.55) 0%,
                        rgba(10, 48, 60, 0.3) 100%
                    );
                "
            />
            <div class="relative z-10 p-10 pb-14 text-white text-start">
                <div
                    class="font-bold mb-3"
                    style="
                        line-height: 1.5;
                        font-size: clamp(1.8rem, 3.5vw, 2.8rem);
                        text-shadow: 2px 4px 12px rgba(0, 0, 0, 0.5);
                    "
                >
                    Smart Grocery<br />Management
                </div>
                <p
                    class="font-medium"
                    style="text-shadow: 1px 2px 8px rgba(0, 0, 0, 0.4)"
                >
                    Efficient POS solutions for your store.
                </p>
            </div>
        </div>

        <!-- Right: form panel -->
        <div
            class="flex items-center justify-center p-6 relative"
            style="background-color: #f3f7ff"
        >
            <router-link to="/" class="absolute top-6 right-6">
                <img
                    :src="logo"
                    alt="Grocery POS Logo"
                    class="h-14 w-auto cursor-pointer"
                />
            </router-link>

            <div class="w-full max-w-md">
                <div class="mb-8">
                    <h1 class="text-2xl font-bold text-slate-800">
                        Welcome Back!
                    </h1>
                    <p class="mt-1 text-slate-500 font-medium">
                        Sign in to your account.
                    </p>
                    <hr class="mt-4" />
                </div>

                <form @submit.prevent="handleLogin">
                    <div class="relative mb-3">
                        <span
                            class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
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
                            aria-label="Username"
                            placeholder="Username"
                            :disabled="loading"
                            class="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/10"
                        />
                    </div>

                    <div class="relative mb-1">
                        <span
                            class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                        >
                            <Lock class="w-5 h-5" />
                        </span>
                        <input
                            id="login-password"
                            v-model="form.password"
                            :type="showPassword ? 'text' : 'password'"
                            name="password"
                            autocomplete="current-password"
                            aria-label="Password"
                            placeholder="••••••••"
                            :disabled="loading"
                            class="w-full pl-11 pr-11 py-2.5 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/10"
                        />
                        <button
                            type="button"
                            class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                        class="mb-5 text-sm text-slate-500"
                        data-testid="forgot-password"
                    >
                        Forgot your password? Ask an admin to reset it.
                    </p>

                    <div
                        v-if="errorMsg"
                        role="alert"
                        data-testid="login-error"
                        class="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium"
                    >
                        {{ errorMsg }}
                    </div>

                    <BaseButton
                        type="submit"
                        block
                        size="lg"
                        :loading="loading"
                    >
                        Login
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
            // No role opens any page: do not stay half signed in.
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
