import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, ref, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { flush } from '@/testing/form-dom';
import type { ApiGet } from '@/testing/api-mock';
import { useUIStore } from '@/stores/ui';
import { useDatePreset } from './useDatePreset';

const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>() }));
vi.mock('@/axios', () => ({ default: api }));

let app: App | null = null;
beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockReset();
});
afterEach(() => {
    app?.unmount();
    app = null;
});

function harness() {
    const from = ref('');
    const to = ref('');
    const apply = vi.fn();
    let preset!: ReturnType<typeof useDatePreset>;
    app = createApp(
        defineComponent({
            setup() {
                preset = useDatePreset(from, to, apply);
                return () => null;
            },
        }),
    );
    app.mount(document.createElement('div'));
    return { from, to, apply, preset };
}

describe('useDatePreset (#215)', () => {
    it('only the latest pick writes and applies', async () => {
        let first!: (v: { data: unknown }) => void;
        api.get
            .mockReturnValueOnce(new Promise((yes) => (first = yes)))
            .mockResolvedValueOnce({
                data: { today: '2026-11-10', timezone: 'Asia/Manila' },
            });
        const { from, to, apply, preset } = harness();
        const a = preset.choose('Today');
        const b = preset.choose('Yesterday');
        await b;
        first({ data: { today: '2026-12-31', timezone: 'Asia/Manila' } });
        await a;
        expect([from.value, to.value]).toEqual(['2026-11-09', '2026-11-09']);
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('Custom changes nothing; All dates clears both and applies once', async () => {
        const { from, to, apply, preset } = harness();
        from.value = '2026-11-01';
        await preset.choose('Custom');
        expect(apply).not.toHaveBeenCalled();
        expect(api.get).not.toHaveBeenCalled();
        await preset.choose(null);
        expect([from.value, to.value]).toEqual(['', '']);
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('a failed store-date read is an error toast and applies nothing', async () => {
        api.get.mockRejectedValue(new Error('offline'));
        const { apply, preset } = harness();
        await preset.choose('This week');
        await flush();
        expect(apply).not.toHaveBeenCalled();
        expect(useUIStore().toasts.map((t) => t.lines.join(' '))).toEqual([
            'Could not read the store date.',
        ]);
    });

    it('a reset or manual edit drops a pending pick', async () => {
        let answer!: (v: { data: unknown }) => void;
        api.get.mockReturnValue(new Promise((yes) => (answer = yes)));
        const { from, apply, preset } = harness();
        const pending = preset.choose('Today');
        preset.edited();
        expect(preset.preset.value).toBe('Custom');
        answer({ data: { today: '2026-11-10', timezone: 'Asia/Manila' } });
        await pending;
        expect(from.value).toBe('');
        expect(apply).not.toHaveBeenCalled();
        preset.reset();
        expect(preset.preset.value).toBeNull();
    });
});
