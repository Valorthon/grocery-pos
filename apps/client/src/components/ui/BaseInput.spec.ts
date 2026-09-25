import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h, nextTick, ref, type VNode } from 'vue';
import BaseInput from './BaseInput.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

function mountRender(render: () => VNode): HTMLInputElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render });
    app.mount(host);
    return host.querySelector('input')!;
}

function mount(props: Record<string, unknown>) {
    return mountRender(() => h(BaseInput, props));
}

/**
 * Mounts BaseInput as `<BaseInput v-model.number="value" />` compiles: the
 * `.number` modifier is the `modelModifiers` prop, which Vue's emit() reads.
 */
function mountNumberModel() {
    const value = ref<unknown>(5);
    const input = mountRender(() =>
        h(BaseInput, {
            type: 'number',
            modelValue: value.value as number,
            modelModifiers: { number: true },
            'onUpdate:modelValue': (v: unknown) => {
                value.value = v;
            },
        }),
    );
    const type = (text: string) => {
        input.value = text;
        input.dispatchEvent(new Event('input'));
    };
    return { value, type };
}

describe('BaseInput maxlength', () => {
    it('puts maxlength on the input itself', () => {
        expect(mount({ maxlength: 30 }).getAttribute('maxlength')).toBe('30');
    });

    it('leaves it off when not given', () => {
        expect(mount({}).hasAttribute('maxlength')).toBe(false);
    });
});

describe('BaseInput attributes (#17)', () => {
    it('passes min, step, inputmode, name and autocomplete to the input', () => {
        const input = mount({
            type: 'number',
            min: '1',
            step: '1',
            inputmode: 'numeric',
            name: 'quantity',
            autocomplete: 'off',
            maxlength: 13,
        });
        expect(input.getAttribute('min')).toBe('1');
        expect(input.getAttribute('step')).toBe('1');
        expect(input.getAttribute('inputmode')).toBe('numeric');
        expect(input.getAttribute('name')).toBe('quantity');
        expect(input.getAttribute('autocomplete')).toBe('off');
        expect(input.getAttribute('maxlength')).toBe('13');
    });

    it('leaves none of them on the wrapper', () => {
        const input = mount({ min: '0', step: '0.01', inputmode: 'decimal' });
        const wrapper = document.body.querySelector('div > div')!;
        expect(wrapper.contains(input)).toBe(true);
        for (const attr of ['min', 'step', 'inputmode'])
            expect(wrapper.hasAttribute(attr)).toBe(false);
    });

    it('keeps class and style on the wrapper, so grid classes still apply', () => {
        const input = mount({
            class: 'md:col-span-3',
            style: 'margin-top: 4px',
        });
        const wrapper = document.body.firstElementChild!
            .firstElementChild as HTMLElement;
        expect(wrapper.classList.contains('md:col-span-3')).toBe(true);
        expect(wrapper.style.marginTop).toBe('4px');
        expect(input.classList.contains('md:col-span-3')).toBe(false);
        expect(input.getAttribute('style')).toBeNull();
    });

    it('still forwards native listeners to the input', () => {
        let focused = 0;
        const input = mount({ onFocus: () => focused++ });
        input.dispatchEvent(new Event('focus'));
        expect(focused).toBe(1);
    });
});

describe('BaseInput v-model.number (#17)', () => {
    it('delivers a typed number as a number', async () => {
        const { value, type } = mountNumberModel();
        type('12');
        await nextTick();
        expect(value.value).toBe(12);
        type('0');
        expect(value.value).toBe(0);
    });

    it('delivers a blank field as "" (so validation must reject it)', () => {
        const { value, type } = mountNumberModel();
        type('');
        expect(value.value).toBe('');
    });
});
