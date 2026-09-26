<template>
    <BaseDropdown v-model="open" align="right" width-class="w-64">
        <template #trigger="{ trigger }">
            <button
                v-if="variant === 'icon'"
                v-bind="trigger"
                class="w-10 h-10 rounded-xl mx-auto flex items-center justify-center bg-slate-100 border border-slate-200 hover:bg-slate-200 transition-colors focus-ring"
                :title="userName"
                :aria-label="`Account menu for ${userName}`"
            >
                <span
                    class="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs"
                >
                    {{ initials }}
                </span>
            </button>

            <button
                v-else-if="variant === 'box'"
                v-bind="trigger"
                class="w-full p-2.5 rounded-xl hover:bg-slate-100 border border-slate-200 bg-white shadow-xs flex items-center justify-between text-left transition-colors focus-ring"
            >
                <div class="flex items-center gap-2.5 min-w-0">
                    <div
                        class="w-8 h-8 rounded-lg bg-primary-600 text-white font-bold text-xs flex items-center justify-center shrink-0"
                    >
                        {{ initials }}
                    </div>
                    <div class="min-w-0 flex-1">
                        <p
                            class="text-xs font-extrabold text-slate-900 truncate leading-tight"
                        >
                            {{ userName }}
                        </p>
                        <p
                            class="text-xs text-slate-500 font-medium truncate mt-0.5"
                        >
                            {{ roleLabel }}
                        </p>
                    </div>
                </div>
                <ChevronUp
                    class="w-4 h-4 text-slate-400 transition-transform"
                    :class="open ? 'rotate-180' : ''"
                />
            </button>

            <button
                v-else
                v-bind="trigger"
                class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all focus-ring"
            >
                <span
                    class="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-extrabold flex items-center justify-center"
                >
                    {{ initials }}
                </span>
                <span class="text-xs font-bold text-slate-800 hidden sm:inline">
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
                        class="w-8 h-8 rounded-lg bg-primary-600 text-white font-bold text-xs flex items-center justify-center shrink-0"
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
                class="w-full px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 flex items-center gap-2.5 text-left transition-colors focus-ring"
                @click="logout"
            >
                <LogOut class="w-4 h-4 text-red-500" />
                <span class="text-xs font-semibold">Log out</span>
            </button>
        </template>
    </BaseDropdown>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, ChevronUp, LogOut } from '@lucide/vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import { useAuthStore } from '@/stores/auth';

withDefaults(defineProps<{ variant?: 'bar' | 'box' | 'icon' }>(), {
    variant: 'bar',
});

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

// Through the page's leave guard: a draft page asks first (issue #19).
function logout() {
    open.value = false;
    void authStore.requestLogout();
}
</script>
