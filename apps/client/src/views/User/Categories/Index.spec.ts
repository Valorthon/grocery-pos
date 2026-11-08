import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import Index from './Index.vue';
import { click, flush, type } from '@/testing/form-dom';
import { useUIStore } from '@/stores/ui';
const api = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
}));
vi.mock('@/axios', () => ({ default: api }));
const row = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Frozen',
    isActive: true,
    sortOrder: 2,
    createdAt: '',
    updatedAt: '',
};
let app: App | undefined;
async function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(Index);
    app.mount(host);
    await flush();
}
async function exact(text: string) {
    const button = [...document.querySelectorAll('button')]
        .reverse()
        .find((b) => b.textContent?.trim() === text);
    if (!button) throw new Error(text);
    button.click();
    await flush();
}
function deferred() {
    let resolve!: (value: unknown) => void, reject!: (value: unknown) => void;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockResolvedValue({ data: { data: [row], totalItems: 1 } });
    api.post.mockResolvedValue({ data: row });
    api.patch.mockResolvedValue({ data: row });
    api.delete.mockResolvedValue({ data: null });
});
afterEach(() => {
    app?.unmount();
    document.body.innerHTML = '';
});
describe('category administration', () => {
    it('shows an empty state when there are no categories (#169)', async () => {
        api.get.mockResolvedValue({ data: { data: [], totalItems: 0 } });
        await mount();
        expect(document.body.textContent).toContain('No categories yet');
    });
    it('loads current categories and creates a dynamic category', async () => {
        await mount();
        expect(document.body.textContent).toContain('Frozen');
        await click('Add category');
        await type('Category name', '  Dairy  ');
        await type('Sort order', '4');
        await exact('Save');
        expect(api.post).toHaveBeenCalledWith('/categories', {
            name: 'Dairy',
            sortOrder: 4,
        });
        await vi.waitFor(() =>
            expect(document.querySelector('[role=dialog]')).toBeNull(),
        );
        expect(api.get.mock.calls.length).toBe(2);
        expect(useUIStore().toasts.flatMap((t) => t.lines)).toContain(
            'Category created',
        );
    });
    it('edits an existing name/order without changing product price permissions', async () => {
        await mount();
        await exact('Edit');
        await type('Category name', 'Frozen foods');
        await type('Sort order', '3');
        await exact('Save');
        expect(api.patch).toHaveBeenCalledWith(`/categories/${row._id}`, {
            name: 'Frozen foods',
            sortOrder: 3,
        });
    });
    it.each([
        ['', '0'],
        ['x'.repeat(61), '0'],
        ['Good', ''],
        ['Good', '-1'],
        ['Good', '1.5'],
        ['Good', '1000001'],
    ])('rejects invalid local fields %s/%s', async (name, order) => {
        await mount();
        await click('Add category');
        await type('Category name', name);
        await type('Sort order', order);
        await exact('Save');
        expect(api.post).not.toHaveBeenCalled();
        expect(document.querySelector('[role=alert]')?.textContent).toContain(
            'valid',
        );
    });
    it('keeps pending saves open; failed save remains visible and can retry', async () => {
        const pending = deferred();
        api.post.mockReturnValueOnce(pending.promise);
        await mount();
        await click('Add category');
        await type('Category name', 'Dairy');
        await exact('Save');
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await flush();
        expect(document.querySelector('[role=dialog]')).not.toBeNull();
        expect(api.post).toHaveBeenCalledTimes(1);
        pending.reject(new Error('Unavailable'));
        await flush();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
        await exact('Save');
        expect(api.post).toHaveBeenCalledTimes(2);
        await vi.waitFor(() =>
            expect(document.querySelector('[role=dialog]')).toBeNull(),
        );
    });
    it('cancels unsaved editing', async () => {
        await mount();
        await click('Add category');
        await exact('Cancel');
        expect(api.post).not.toHaveBeenCalled();
    });
    it('confirms archive and restore while retaining category rows', async () => {
        await mount();
        await exact('Archive');
        expect(api.patch).not.toHaveBeenCalled();
        await exact('Archive');
        expect(api.patch).toHaveBeenCalledWith(`/categories/${row._id}`, {
            isActive: false,
        });
    });
    it('restores an archived category', async () => {
        api.get.mockResolvedValue({
            data: { data: [{ ...row, isActive: false }], totalItems: 1 },
        });
        await mount();
        await exact('Restore');
        await exact('Restore');
        expect(api.patch).toHaveBeenCalledWith(`/categories/${row._id}`, {
            isActive: true,
        });
    });
    it('confirms delete and reports referenced-category rejection without removing it', async () => {
        api.delete.mockRejectedValue(new Error('Referenced'));
        await mount();
        await exact('Delete');
        await exact('Delete');
        expect(api.delete).toHaveBeenCalledWith(`/categories/${row._id}`);
        expect(document.body.textContent).toContain('Frozen');
        expect(useUIStore().toasts.length).toBeGreaterThan(0);
    });
    it('deletes an unused row and retries a list error', async () => {
        api.get.mockRejectedValueOnce(new Error('offline'));
        await mount();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
        await exact('Retry');
        await exact('Delete');
        await exact('Delete');
        expect(api.delete).toHaveBeenCalled();
    });
    it('reports an archive request failure', async () => {
        api.patch.mockRejectedValue(new Error('offline'));
        await mount();
        await exact('Archive');
        await exact('Archive');
        expect(useUIStore().toasts.length).toBeGreaterThan(0);
    });
});
