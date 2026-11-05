import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, reactive, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ProductCostSummary from './ProductCostSummary.vue';
import { flush } from '@/testing/form-dom';
import { UnitOfMeasure } from '@grocery-pos/contracts';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | undefined;
async function mount() {
    const props = reactive({ product: 'one', unit: UnitOfMeasure.KG });
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp({ render: () => h(ProductCostSummary, props) });
    app.mount(host);
    await flush();
    return props;
}
beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockResolvedValue({
        data: [{ product: 'one', lastCost: 6000, marginBasisPoints: 4000 }],
    });
});
afterEach(() => {
    app?.unmount();
    document.body.innerHTML = '';
});
describe('latest receipt margin estimate', () => {
    it('shows cost per measure and explicitly labels the margin estimate', async () => {
        await mount();
        expect(document.body.textContent).toContain('60.00/kg');
        expect(document.body.textContent).toContain('Margin estimate: 40.00%');
    });
    it('keeps unknown distinct from free stock', async () => {
        api.get.mockResolvedValueOnce({ data: [{ product: 'one' }] });
        const props = await mount();
        expect(document.body.textContent).toContain('Cost unknown');
        api.get.mockResolvedValue({
            data: [{ product: 'two', lastCost: 0, marginBasisPoints: 10000 }],
        });
        props.product = 'two';
        await flush();
        expect(document.body.textContent).toContain('0.00/kg');
        expect(document.body.textContent).toContain('100.00%');
    });
    it('omits admin margin when server only returns procurement cost', async () => {
        api.get.mockResolvedValue({
            data: [{ product: 'one', lastCost: 8000 }],
        });
        await mount();
        expect(document.body.textContent).toContain('80.00/kg');
        expect(document.body.textContent).not.toContain('Margin estimate');
    });
    it('shows load failures and retries', async () => {
        api.get.mockRejectedValueOnce(new Error('offline'));
        await mount();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
        document.querySelector<HTMLButtonElement>('button')!.click();
        await flush();
        expect(document.body.textContent).toContain('60.00/kg');
    });
    it('does not publish an old request after product change or unmount', async () => {
        let resolve!: (value: unknown) => void;
        api.get.mockReturnValueOnce(
            new Promise((yes) => {
                resolve = yes;
            }),
        );
        const props = await mount();
        props.product = 'two';
        await flush();
        expect(document.body.textContent).toContain('60.00/kg');
        resolve({ data: [{ product: 'one', lastCost: 999 }] });
        await flush();
        expect(document.body.textContent).not.toContain('9.99');
        app?.unmount();
        app = undefined;
    });
});
