<template>
    <!-- fill-height makes this row take full remaining height inside v-main -->
    <v-row density="compact" class="fill-height" style="min-height: 100dvh">
        <!-- LEFT: Image panel — hidden on mobile -->
        <v-col
            cols="12"
            md="6"
            class="d-none d-md-flex align-start"
            style="
                background: url('https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200')
                    center/cover no-repeat;
                position: relative;
            "
        >
            <!-- Dark overlay — inline style required for gradient over bg image -->
            <div
                class="w-100 h-100 position-absolute"
                style="
                    inset: 0;
                    background: linear-gradient(
                        160deg,
                        rgba(10, 48, 60, 0.55) 0%,
                        rgba(10, 48, 60, 0.3) 100%
                    );
                "
            />

            <!-- Content on top of overlay -->
            <div class="position-relative pa-10 pb-14 text-white text-start">
                <div
                    class="font-weight-bold mb-3"
                    style="
                        line-height: 1.5;
                        font-size: clamp(1.8rem, 3.5vw, 2.8rem);
                        text-shadow: 2px 4px 12px rgba(0, 0, 0, 0.5);
                    "
                >
                    Smart Grocery<br />Management
                </div>
                <p
                    class="font-weight-medium"
                    style="text-shadow: 1px 2px 8px rgba(0, 0, 0, 0.4)"
                >
                    Efficient POS solutions for your store.
                </p>
            </div>
        </v-col>

        <!-- RIGHT: Form panel -->
        <v-col
            cols="12"
            md="6"
            class="d-flex align-center justify-center pa-6 position-relative"
            style="background-color: #f3f7ff"
        >
            <!-- logo -->
            <router-link
                to="/"
                style="position: absolute; top: 24px; right: 24px"
            >
                <img
                    :src="logo"
                    alt="Grocery POS Logo"
                    height="60"
                    style="cursor: pointer"
                />
            </router-link>

            <v-sheet max-width="560" width="100%" color="transparent">
                <div class="mb-8">
                    <!-- <p class="text-overline text-primary font-weight-bold mb-1">Welcome Back</p> -->
                    <h1 class="text-h5 font-weight-bold text-grey-darken-4">
                        Welcome Back!
                    </h1>
                    <p
                        class="mt-1 text-body-2 text-grey-darken-2 font-weight-medium"
                    >
                        Sign in to your account.
                    </p>
                    <hr />
                </div>

                <v-form ref="formRef" @submit.prevent="handleLogin">
                    <v-text-field
                        v-model="form.username"
                        :rules="usernameRules"
                        variant="outlined"
                        density="comfortable"
                        label="Username"
                        placeholder="you@example.com"
                        prepend-inner-icon="mdi-email-outline"
                        rounded="lg"
                        class="mb-3"
                        :disabled="loading"
                        bg-color="white"
                    />

                    <v-text-field
                        v-model="form.password"
                        :rules="passwordRules"
                        :type="showPassword ? 'text' : 'password'"
                        variant="outlined"
                        density="comfortable"
                        label="Password"
                        placeholder="••••••••"
                        prepend-inner-icon="mdi-lock-outline"
                        :append-inner-icon="
                            showPassword
                                ? 'mdi-eye-off-outline'
                                : 'mdi-eye-outline'
                        "
                        rounded="lg"
                        class="mb-1"
                        :disabled="loading"
                        bg-color="white"
                        @click:append-inner="showPassword = !showPassword"
                    />

                    <div class="d-flex justify-space-between align-center mb-5">
                        <v-checkbox
                            v-model="rememberMe"
                            label="Remember me"
                            density="compact"
                            hide-details
                            color="primary"
                        />
                        <v-btn
                            variant="text"
                            color="primary"
                            size="small"
                            class="text-caption"
                        >
                            Forgot password?
                        </v-btn>
                    </div>

                    <!-- Error Alert -->
                    <v-alert
                        v-if="errorMsg"
                        type="error"
                        variant="tonal"
                        rounded="lg"
                        class="mb-4"
                        density="compact"
                        :text="errorMsg"
                        closable
                        @click:close="errorMsg = ''"
                    />

                    <v-btn
                        type="submit"
                        color="primary"
                        block
                        size="large"
                        rounded="lg"
                        variant="flat"
                        :loading="loading"
                        class="font-weight-bold"
                    >
                        Login
                        <!-- <v-icon end>mdi-arrow-right</v-icon> -->
                    </v-btn>
                </v-form>

                <!-- <p class="text-center text-caption text-medium-emphasis mt-6">
          By signing in you agree to our
          <v-btn variant="text" color="primary">Terms</v-btn>
          and
          <v-btn variant="text" color="primary" size="x-small" class="px-1">Privacy Policy</v-btn>
        </p> -->
            </v-sheet>

            <div class="d-flex ga-8 position-absolute" style="bottom: 24px">
                <v-btn variant="text" color="grey-darken-2" size="small"
                    >Privacy</v-btn
                >
                <v-btn variant="text" color="grey-darken-2" size="small"
                    >Terms</v-btn
                >
            </div>
        </v-col>
    </v-row>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import type { VForm } from 'vuetify/components';
import logo from '@/assets/logo-icon.svg';

const router = useRouter();
const authStore = useAuthStore();
const formRef = ref<VForm | null>(null);
const loading = ref(false);
const showPassword = ref(false);
const rememberMe = ref(false);
const errorMsg = ref('');

const form = reactive({ username: 'admin', password: 'a' });

const usernameRules = [
    (v: string) => !!v || 'username is required',
    // v => /.+@.+\..+/.test(v) || 'Must be a valid username',
];
const passwordRules = [
    (v: string) => !!v || 'Password is required',
    // v => v.length >= 6 || 'Minimum 6 characters',
];

const handleLogin = async () => {
    const { valid } = await formRef.value!.validate();
    if (!valid) return;

    loading.value = true;
    errorMsg.value = '';

    try {
        console.log({ form });
        await authStore.login(form.username, form.password);
        router.push({ name: 'Dashboard' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
        errorMsg.value =
            err?.response?.data?.error ||
            'Invalid credentials. Please try again.';
    } finally {
        loading.value = false;
    }
};
</script>
