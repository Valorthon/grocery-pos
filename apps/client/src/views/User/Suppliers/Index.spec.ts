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
    name: 'Farm',
    contactPerson: 'Ana',
    phone: '123',
    email: 'ana@example.com',
    address: 'Manila',
    TIN: '001-234',
    isActive: true,
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
describe('supplier administration', () => {
    it('loads all pages and creates a supplier with trimmed contact details', async () => {
        api.get
            .mockResolvedValueOnce({ data: { data: [row], totalItems: 2 } })
            .mockResolvedValueOnce({
                data: {
                    data: [{ ...row, _id: 'other', name: 'Other farm' }],
                    totalItems: 2,
                },
            });
        await mount();
        expect(document.body.textContent).toContain('Other farm');
        await click('Add supplier');
        await type('Supplier name', '  Dairy Farm  ');
        await type('Phone', '  +63 123  ');
        await type('TIN', ' 123-456 ');
        await exact('Save');
        expect(api.post).toHaveBeenCalledWith('/suppliers', {
            name: 'Dairy Farm',
            contactPerson: '',
            phone: '+63 123',
            email: '',
            address: '',
            TIN: '123-456',
        });
        await vi.waitFor(() =>
            expect(document.querySelector('[role=dialog]')).toBeNull(),
        );
    });
    it('edits and clears optional contact fields without losing the supplier identity', async () => {
        await mount();
        await exact('Edit');
        await type('Supplier name', 'Fresh Farm');
        await type('Email', '');
        await exact('Save');
        expect(api.patch).toHaveBeenCalledWith(`/suppliers/${row._id}`, {
            name: 'Fresh Farm',
            contactPerson: 'Ana',
            phone: '123',
            email: '',
            address: 'Manila',
            TIN: '001-234',
        });
    });
    it.each(['', '   ', 'x'.repeat(121)])(
        'rejects invalid name before submitting %s',
        async (name) => {
            await mount();
            await click('Add supplier');
            await type('Supplier name', name);
            await exact('Save');
            expect(api.post).not.toHaveBeenCalled();
            expect(document.querySelector('[role=alert]')).not.toBeNull();
        },
    );
    it('keeps pending saves open, retains failure and supports retry', async () => {
        const pending = deferred();
        api.post.mockReturnValueOnce(pending.promise);
        await mount();
        await click('Add supplier');
        await type('Supplier name', 'Farm');
        await exact('Save');
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await flush();
        expect(document.querySelector('[role=dialog]')).not.toBeNull();
        pending.reject(new Error('offline'));
        await flush();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
        await exact('Save');
        await vi.waitFor(() =>
            expect(document.querySelector('[role=dialog]')).toBeNull(),
        );
    });
    it('cancels unsaved editing', async () => {
        await mount();
        await click('Add supplier');
        await exact('Cancel');
        expect(api.post).not.toHaveBeenCalled();
    });
    it('confirms archiving and restoring while retaining history rows', async () => {
        await mount();
        await exact('Archive');
        expect(api.patch).not.toHaveBeenCalled();
        await exact('Archive');
        expect(api.patch).toHaveBeenCalledWith(`/suppliers/${row._id}`, {
            isActive: false,
        });
    });
    it('restores an archived supplier', async () => {
        api.get.mockResolvedValue({
            data: { data: [{ ...row, isActive: false }], totalItems: 1 },
        });
        await mount();
        await exact('Restore');
        await exact('Restore');
        expect(api.patch).toHaveBeenCalledWith(`/suppliers/${row._id}`, {
            isActive: true,
        });
    });
    it('reports referenced deletion failure without losing supplier rows', async () => {
        api.delete.mockRejectedValue(new Error('Referenced'));
        await mount();
        await exact('Delete');
        await exact('Delete');
        expect(api.delete).toHaveBeenCalledWith(`/suppliers/${row._id}`);
        expect(document.body.textContent).toContain('Farm');
        expect(useUIStore().toasts.length).toBeGreaterThan(0);
    });
    it('retries list errors and deletes unused suppliers', async () => {
        api.get.mockRejectedValueOnce(new Error('offline'));
        await mount();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
        await exact('Retry');
        await exact('Delete');
        await exact('Delete');
        expect(api.delete).toHaveBeenCalled();
    });
    it('reports archive errors and lets cancelled confirmation return to list', async () => {
        api.patch.mockRejectedValue(new Error('offline'));
        await mount();
        await exact('Archive');
        await exact('Cancel');
        await vi.waitFor(() =>
            expect(document.querySelector('[role=dialog]')).toBeNull(),
        );
        expect(api.patch).not.toHaveBeenCalled();
        await exact('Archive');
        await exact('Archive');
        expect(useUIStore().toasts.length).toBeGreaterThan(0);
    });
    it('ignores an unfinished lookup after the page unmounts', async () => {
        const pending = deferred();
        api.get.mockReturnValue(pending.promise);
        await mount();
        app?.unmount();
        app = undefined;
        pending.resolve({ data: { data: [row], totalItems: 1 } });
        await flush();
        expect(document.body.textContent).not.toContain('Farm');
    });
});
