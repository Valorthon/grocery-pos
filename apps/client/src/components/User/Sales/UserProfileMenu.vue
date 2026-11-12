<template>
    <BaseDropdown
        ref="dropdown"
        v-model="open"
        :align="variant === 'bar' ? 'right' : 'left'"
        width-class="w-64"
        floating
    >
        <template #trigger="{ trigger }">
            <button
                v-if="variant === 'icon'"
                v-bind="trigger"
                class="w-11 h-11 rounded-xl mx-auto flex items-center justify-center border transition-colors"
                :class="tones.icon"
                :title="userName"
                :aria-label="`Account menu for ${userName}`"
            >
                <span
                    class="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs"
                    :class="tones.iconInitials"
                >
                    {{ initials }}
                </span>
            </button>

            <button
                v-else-if="variant === 'box'"
                v-bind="trigger"
                class="w-full p-2.5 rounded-xl border flex items-center justify-between text-left transition-colors"
                :class="tones.box"
            >
                <div class="flex items-center gap-2.5 min-w-0">
                    <div
                        class="w-8 h-8 rounded-lg bg-leaf-600 text-white font-bold text-xs flex items-center justify-center shrink-0"
                    >
                        {{ initials }}
                    </div>
                    <div class="min-w-0 flex-1">
                        <p
                            class="text-xs font-extrabold truncate leading-tight"
                            :class="tones.name"
                        >
                            {{ userName }}
                        </p>
                        <p
                            class="text-xs font-medium truncate mt-0.5"
                            :class="tones.role"
                        >
                            {{ roleLabel }}
                        </p>
                    </div>
                </div>
                <ChevronUp
                    class="w-4 h-4 transition-transform"
                    :class="[tones.chevron, open ? 'rotate-180' : '']"
                />
            </button>

            <button
                v-else
                v-bind="trigger"
                class="min-h-11 flex items-center gap-1 sm:gap-2 px-1.5 sm:px-2.5 py-1.5 rounded-xl hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all focus-ring"
            >
                <span
                    class="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-extrabold flex items-center justify-center"
                >
                    {{ initials }}
                </span>
                <span
                    class="text-xs font-bold text-slate-800 hidden sm:inline max-w-32 truncate"
                    :title="userName"
                >
                    {{ userName }}
                </span>
                <ChevronDown class="w-3.5 h-3.5 text-slate-500" />
            </button>
        </template>

        <template #menu>
            <div
                role="none"
                class="p-3 rounded-xl bg-slate-50 border border-slate-200 mb-1.5"
            >
                <div class="flex items-center gap-3">
                    <div
                        class="w-8 h-8 rounded-lg bg-leaf-600 text-white font-bold text-xs flex items-center justify-center shrink-0"
                    >
                        {{ initials }}
                    </div>
                    <div class="min-w-0">
                        <p class="text-xs font-bold text-slate-900 truncate">
                            {{ userName }}
                        </p>
                        <p class="text-xs text-slate-500 truncate font-medium">
                            {{ roleLabel }}
                        </p>
                    </div>
                </div>
            </div>

            <button
                type="button"
                role="menuitem"
                class="w-full px-3 py-2 rounded-lg hover:bg-slate-100 text-slate-700 flex items-center gap-2.5 text-left transition-colors focus-ring"
                data-testid="change-password"
                @click="openChangePassword"
            >
                <KeyRound class="w-4 h-4 text-slate-500" />
                <span class="text-xs font-semibold">Change password</span>
            </button>

            <button
                type="button"
                role="menuitem"
                class="w-full px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 flex items-center gap-2.5 text-left transition-colors focus-ring"
                @click="logout"
            >
                <LogOut class="w-4 h-4 text-red-500" />
                <span class="text-xs font-semibold">Log out</span>
            </button>
        </template>
    </BaseDropdown>

    <!-- Teleported to the body, so it sits outside the menu (#88). -->
    <ChangePasswordDialog v-model="changingPassword" />
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import { ChevronDown, ChevronUp, KeyRound, LogOut } from '@lucide/vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import ChangePasswordDialog from '@/components/User/Account/ChangePasswordDialog.vue';
import { useAuthStore } from '@/stores/auth';

const props = withDefaults(
    defineProps<{
        variant?: 'bar' | 'box' | 'icon';
        /** `dark`: on the admin sidebar's leaf-900 (#160). */
        tone?: 'light' | 'dark';
    }>(),
    { variant: 'bar', tone: 'light' },
);

/** Trigger colours per tone; each set is complete, never layered. */
const tones = computed(() =>
    props.tone === 'dark'
        ? {
              icon: 'bg-leaf-800 border-leaf-700 hover:bg-leaf-700 focus-ring-inverse',
              iconInitials: 'bg-leaf-700 text-white',
              box: 'bg-leaf-800 border-leaf-700 hover:bg-leaf-700 focus-ring-inverse',
              name: 'text-white',
              role: 'text-leaf-200',
              chevron: 'text-leaf-200',
          }
        : {
              icon: 'bg-slate-100 border-slate-200 hover:bg-slate-200 focus-ring',
              iconInitials: 'bg-slate-200 text-slate-700',
              box: 'bg-white border-slate-200 hover:bg-slate-100 shadow-xs focus-ring',
              name: 'text-slate-900',
              role: 'text-slate-500',
              chevron: 'text-slate-400',
          },
);

const authStore = useAuthStore();
const open = ref(false);

const userName = computed(() => authStore.user?.username ?? 'User');
const initials = computed(() =>
    userName.value
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2),
);

const roleLabel = computed(() => {
    const roles = authStore.user?.roles ?? [];
    if (roles.length === 0) return '';
    return roles
        .map((r) =>
            r
                .toLowerCase()
                .split('_')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '),
        )
        .join(', ');
});

const changingPassword = ref(false);
const dropdown = useTemplateRef<InstanceType<typeof BaseDropdown>>('dropdown');

/**
 * Opens the change-password dialog (#88). The menu item goes away with the
 * menu, so the account button takes the focus first: the dialog gives it
 * back there when it closes.
 */
function openChangePassword() {
    open.value = false;
    const root: unknown = dropdown.value?.$el;
    if (root instanceof HTMLElement) {
        root.querySelector<HTMLElement>('[data-dropdown-trigger]')?.focus();
    }
    changingPassword.value = true;
}

// Through the page's leave guard: a draft page asks first (issue #19).
function logout() {
    open.value = false;
    void authStore.requestLogout();
}
</script>
