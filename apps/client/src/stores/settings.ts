import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/axios';
import {
    type StoreSettings,
    type UpdateStoreSettingsRequest,
} from '@grocery-pos/contracts';
import { apiErrorText } from '@/utils/api-error';
import {
    initialSettings,
    storePresentation,
    validSettings,
} from '@/settings/presentation';
const key = (owner: string) => `grocery_pos_settings_v1:${owner}`;
/** Last-known presentation only; API settings are never service-worker cached. */
export const useSettingsStore = defineStore('settings', () => {
    const owner = ref<string>();
    const loading = ref(false),
        error = ref('');
    let generation = 0;
    let savedRevision = 0;
    let inFlight: Promise<void> | undefined;
    function setOwner(id?: string) {
        if (id === owner.value) return;
        generation += 1;
        inFlight = undefined;
        loading.value = false;
        error.value = '';
        owner.value = id;
        storePresentation.value = { ...initialSettings };
        if (id) {
            try {
                const value: unknown = JSON.parse(
                    localStorage.getItem(key(id)) ?? 'null',
                );
                if (validSettings(value)) storePresentation.value = value;
            } catch {
                /* malformed presentation cache is ignored */
            }
        }
    }
    function apply(data: StoreSettings) {
        if (!validSettings(data))
            throw new Error('Invalid store settings response');
        // Versions are monotonic within the active owner's singleton snapshot.
        // A delayed GET (or PATCH) must never roll back a newer accepted save.
        if (data.version < storePresentation.value.version) return;
        storePresentation.value = data;
        if (owner.value) {
            try {
                localStorage.setItem(key(owner.value), JSON.stringify(data));
            } catch {
                /* online values still apply if presentation cache is full */
            }
        }
    }
    async function refresh(): Promise<void> {
        if (!owner.value) return;
        if (inFlight) return inFlight;
        const gen = generation;
        const revision = savedRevision;
        loading.value = true;
        error.value = '';
        const task = (async () => {
            try {
                const response = await api.get<StoreSettings>('/settings');
                if (gen === generation) apply(response.data);
            } catch (cause) {
                if (gen === generation && revision === savedRevision)
                    error.value = apiErrorText(
                        cause,
                        'Could not refresh store settings. Showing last-known settings.',
                    );
            } finally {
                if (gen === generation) {
                    loading.value = false;
                    inFlight = undefined;
                }
            }
        })();
        inFlight = task;
        return task;
    }
    async function load(id: string) {
        setOwner(id);
        await refresh();
    }
    async function save(body: UpdateStoreSettingsRequest): Promise<boolean> {
        const gen = generation;
        const response = await api.patch<StoreSettings>('/settings', body);
        if (gen !== generation || !owner.value) return false;
        apply(response.data);
        savedRevision += 1;
        error.value = '';
        return true;
    }
    return {
        settings: storePresentation,
        owner,
        loading,
        error,
        setOwner,
        refresh,
        load,
        save,
    };
});
