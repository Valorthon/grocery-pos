import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import SupplierSelect from './SupplierSelect.vue';
import { flush } from '@/testing/form-dom';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | undefined;
async function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(SupplierSelect);
    app.mount(host);
    await flush();
}
beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockResolvedValue({
        data: {
            data: [
                { _id: 'one', name: 'Farm', isActive: true },
                { _id: 'old', name: 'Archived', isActive: false },
            ],
            totalItems: 2,
        },
    });
});
afterEach(() => {
    app?.unmount();
    document.body.innerHTML = '';
});
describe('active supplier selection', () => {
    it('offers active suppliers and excludes archived suppliers', async () => {
        await mount();
        const options = [...document.querySelectorAll('option')].map(
            (row) => row.textContent,
        );
        expect(options).toContain('Farm');
        expect(options).not.toContain('Archived');
    });
    it('exposes catalogue errors and retries the lookup', async () => {
        api.get.mockRejectedValueOnce(new Error('offline'));
        await mount();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
        document.querySelector<HTMLButtonElement>('button')!.click();
        await flush();
        expect(document.querySelector('[role=alert]')).toBeNull();
        expect(document.body.textContent).toContain('Farm');
    });
});
