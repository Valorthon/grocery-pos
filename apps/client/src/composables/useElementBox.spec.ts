import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick, ref } from 'vue';
import { type ElementBox, useElementBox } from './useElementBox';

let observed: ResizeObserverCallback | null = null;
const disconnect = vi.fn();

class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
        observed = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {
        disconnect();
    }
}

let app: App | null = null;
let box: { value: ElementBox | null };
let rect = { left: 0, width: 0 };

function mount() {
    const Probe = defineComponent({
        setup() {
            const el = ref<HTMLElement | null>(null);
            box = useElementBox(el);
            return () => h('div', { ref: el });
        },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Probe);
    app.mount(host);
    const div = host.firstElementChild as HTMLElement;
    div.getBoundingClientRect = () =>
        ({ left: rect.left, width: rect.width }) as DOMRect;
    return div;
}

beforeEach(() => {
    observed = null;
    disconnect.mockReset();
    rect = { left: 0, width: 0 };
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('useElementBox (#85)', () => {
    it('is null without ResizeObserver', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        mount();
        expect(box.value).toBeNull();
    });

    it('follows the element as it resizes and as the window does', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        mount();
        // Not laid out yet (no size): nothing to centre on.
        expect(box.value).toBeNull();

        // The sidebar expanded: the column starts at 256px.
        rect = { left: 256, width: 368 };
        observed!([], {} as ResizeObserver);
        expect(box.value).toEqual({ center: 440, width: 368 });

        // Collapsed to 80px.
        rect = { left: 80, width: 544 };
        window.dispatchEvent(new Event('resize'));
        expect(box.value).toEqual({ center: 352, width: 544 });

        const same = box.value;
        window.dispatchEvent(new Event('resize'));
        expect(box.value).toBe(same);

        app!.unmount();
        app = null;
        await nextTick();
        expect(disconnect).toHaveBeenCalled();
    });
});
