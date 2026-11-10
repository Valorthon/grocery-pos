import { onBeforeUnmount, ref, type Ref } from 'vue';
import type { StoreToday } from '@grocery-pos/contracts';
import api from '@/axios';
import { Color, useUIStore } from '@/stores/ui';
import { apiErrorText } from '@/utils/api-error';
import { presetRange, type DatePreset } from '@/views/User/Reports/presets';

/** The store-calendar date from the server, never the device clock (#215). */
export async function fetchStoreToday(): Promise<string> {
    const { data } = await api.get<StoreToday>('/settings/today');
    return data.today;
}

/**
 * A list's date preset (#215). `null` is "All dates" (no preset). Picking
 * a preset fetches the store's today, fills both dates and calls `apply`
 * once; a manual date edit calls `edited()`, which switches to Custom.
 * Only the latest pick writes; a reset or unmount drops a pending one.
 */
export function useDatePreset(
    from: Ref<string>,
    to: Ref<string>,
    apply: () => void,
) {
    const preset = ref<DatePreset | null>(null);
    let turn = 0;
    let alive = true;
    onBeforeUnmount(() => {
        alive = false;
    });
    async function choose(value: DatePreset | null) {
        const mine = ++turn;
        preset.value = value;
        if (value === 'Custom') return;
        if (value === null) {
            from.value = '';
            to.value = '';
            apply();
            return;
        }
        let today: string;
        try {
            today = await fetchStoreToday();
        } catch (cause) {
            if (alive && mine === turn)
                useUIStore().queueMessage(
                    Color.ERROR,
                    apiErrorText(cause, 'Could not read the store date.'),
                );
            return;
        }
        if (!alive || mine !== turn) return;
        const range = presetRange(value, today);
        if (!range) return;
        from.value = range.from;
        to.value = range.to;
        apply();
    }
    function edited() {
        turn++;
        preset.value = 'Custom';
    }
    function reset() {
        turn++;
        preset.value = null;
    }
    return { preset, choose, edited, reset };
}
