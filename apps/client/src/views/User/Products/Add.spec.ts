import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent } from 'vue';
import { type Pinia, createPinia } from 'pinia';
import { AxiosError, AxiosHeaders } from 'axios';
import { click, flush } from '@/testing/form-dom';
import { useUIStore } from '@/stores/ui';
import type { ProductDraft } from '@/utils/payloads';
import Add from './Add.vue';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal<typeof import('vue-router')>()),
    useRouter: () => ({ push: vi.fn() }),
    onBeforeRouteLeave: vi.fn(),
}));

// The dialog is covered by AddDialog.spec.ts; here it only adds drafts.
const dialog = vi.hoisted(() => ({
    add: null as null | ((p: ProductDraft) => void),
    update: null as null | ((p: ProductDraft) => void),
}));
vi.mock('@/components/User/Product/AddDialog.vue', () => ({
    default: defineComponent({
        emits: ['add', 'update', 'update:modelValue'],
        setup(_props, { emit }) {
            dialog.add = (p) => emit('add', p);
            dialog.update = (p) => emit('update', p);
            return () => null;
        },
    }),
}));

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    api.post.mockReset();
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(names: string[]) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    pinia = createPinia();
    app = createApp(Add);
    app.use(pinia);
    app.mount(host);
    await flush();
    for (const name of names)
        dialog.add!({ EAN: '', name, price: 1000, autoGenerateEAN: true });
    await flush();
    useUIStore(pinia).toasts.splice(0);
}

const failure = (error: string, details: unknown) =>
    new AxiosError('fail', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { statusCode: 400, error, message: 'fail', details },
    });

const nameErrors = () =>
    [...document.querySelectorAll('tbody tr')].map(
        (row) =>
            row
                .querySelector('[data-testid="draft-name-error"]')
                ?.textContent?.trim() ?? '',
    );
const toasts = () => useUIStore(pinia).toasts.flatMap((t) => t.lines);

describe('Add Products save, a taken name (#455)', () => {
    it('shows it under the offending draft, with no toast', async () => {
        await mount(['MILK', 'BREAD', 'EGGS']);
        api.post.mockRejectedValue(
            failure('DB_002', [
                { msg: 'Already exists', property: 'name', index: 1 },
            ]),
        );
        await click('Save All');
        expect(nameErrors()).toEqual([
            '',
            'A product with this name already exists',
            '',
        ]);
        expect(toasts()).toEqual([]);
    });

    it('clears it when that draft is edited', async () => {
        await mount(['MILK', 'BREAD']);
        api.post.mockRejectedValue(
            failure('DB_002', [
                { msg: 'Already exists', property: 'name', index: 1 },
            ]),
        );
        await click('Save All');
        expect(nameErrors()).toEqual([
            '',
            'A product with this name already exists',
        ]);
        document
            .querySelector<HTMLButtonElement>(
                'button[aria-label="Edit draft BREAD"]',
            )!
            .click();
        await flush();
        dialog.update!({
            EAN: '',
            name: 'RYE BREAD',
            price: 1000,
            autoGenerateEAN: true,
        });
        await flush();
        expect(nameErrors()).toEqual(['', '']);
    });

    it('clears it when that draft is deleted', async () => {
        await mount(['MILK', 'BREAD']);
        api.post.mockRejectedValue(
            failure('DB_002', [
                { msg: 'Already exists', property: 'name', index: 0 },
            ]),
        );
        await click('Save All');
        document
            .querySelector<HTMLButtonElement>(
                'button[aria-label="Delete draft MILK"]',
            )!
            .click();
        await flush();
        expect(nameErrors()).toEqual(['']);
    });

    it('stays a toast without a position or for another error', async () => {
        await mount(['MILK']);
        api.post.mockRejectedValue(
            failure('DB_002', [{ msg: 'Already exists', property: 'name' }]),
        );
        await click('Save All');
        expect(nameErrors()).toEqual(['']);
        expect(toasts().length).toBeGreaterThan(0);

        useUIStore(pinia).toasts.splice(0);
        api.post.mockRejectedValue(
            failure('DB_002', [
                { property: 'EAN', msg: 'Already exists', index: 0 },
            ]),
        );
        await click('Save All');
        expect(nameErrors()).toEqual(['']);
        expect(toasts().length).toBeGreaterThan(0);
    });
});
