import { onMounted, onBeforeUnmount } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
/** Refresh presentation on focus/online and across long-lived admin sessions. */
export function useStoreSettings() {
    const settings = useSettingsStore();
    const refresh = () => {
        const owner = useAuthStore().user?.userId;
        if (owner) void settings.load(owner);
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    onMounted(() => {
        refresh();
        window.addEventListener('focus', refresh);
        window.addEventListener('online', refresh);
        timer = setInterval(refresh, 30_000);
    });
    onBeforeUnmount(() => {
        window.removeEventListener('focus', refresh);
        window.removeEventListener('online', refresh);
        if (timer) clearInterval(timer);
    });
}
