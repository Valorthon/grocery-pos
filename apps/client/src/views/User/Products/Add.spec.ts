import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, type PropType, createApp, defineComponent } from 'vue';
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
    editDraft: null as null | ((id: string, dirty: boolean) => void),
    props: {} as {
        modelValue?: boolean;
        item?: Partial<ProductDraft>;
        drafts?: { draftId: string; name?: string }[];
        editingId?: string | null;
    },
}));
vi.mock('@/components/User/Product/AddDialog.vue', () => ({
    default: defineComponent({
        props: {
            modelValue: Boolean,
            item: {
                type: Object as PropType<Partial<ProductDraft>>,
                default: undefined,
            },
            drafts: {
                type: Array as PropType<{ draftId: string; name?: string }[]>,
                default: undefined,
            },
            editingId: { type: String, default: null },
        },
        emits: ['add', 'update', 'update:modelValue', 'edit-draft'],
        setup(props, { emit }) {
            dialog.props = props;
            dialog.add = (p) => emit('add', p);
            dialog.update = (p) => emit('update', p);
            dialog.editDraft = (id, dirty) => emit('edit-draft', id, dirty);
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
const eanErrors = () =>
    [...document.querySelectorAll('tbody tr')].map(
        (row) =>
            row
                .querySelector('[data-testid="draft-ean-error"]')
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
            failure('DB_001', [{ field: 'name', message: 'bad' }]),
        );
        await click('Save All');
        expect(nameErrors()).toEqual(['']);
        expect(toasts().length).toBeGreaterThan(0);
    });
});

describe('Add Products save, every clash at once (#470)', () => {
    const CLASHES = [
        { property: 'name', msg: 'Already exists', index: 0 },
        { property: 'EAN', msg: 'Already exists', index: 1 },
        { property: 'name', msg: 'Already exists', index: 2 },
        { property: 'name', msg: 'Repeated in this list', index: 3 },
        { property: 'EAN', msg: 'Repeated in this list', index: 3 },
    ];

    it('flags every draft, with no toast; an edit clears its own and the repeats', async () => {
        await mount(['MILK', 'BREAD', 'EGGS', 'MILK']);
        api.post.mockRejectedValue(failure('DB_002', CLASHES));
        await click('Save All');
        expect(nameErrors()).toEqual([
            'A product with this name already exists',
            '',
            'A product with this name already exists',
            'Another draft above already uses this name',
        ]);
        expect(eanErrors()).toEqual([
            '',
            'A product with this barcode already exists',
            '',
            'Another draft above already uses this barcode',
        ]);
        expect(toasts()).toEqual([]);

        document
            .querySelector<HTMLButtonElement>(
                'button[aria-label="Edit draft EGGS"]',
            )!
            .click();
        await flush();
        dialog.update!({
            EAN: '',
            name: 'DUCK EGGS',
            price: 1000,
            autoGenerateEAN: true,
        });
        await flush();
        expect(nameErrors()).toEqual([
            'A product with this name already exists',
            '',
            '',
            // Any edit may resolve a repeat, so repeats clear too.
            '',
        ]);
        expect(eanErrors()[1]).toBe(
            'A product with this barcode already exists',
        );
    });

    it("clears a later draft's repeat error when the earlier one is deleted", async () => {
        await mount(['MILK', 'BREAD', 'MILK']);
        api.post.mockRejectedValue(
            failure('DB_002', [
                { property: 'name', msg: 'Already exists', index: 1 },
                { property: 'name', msg: 'Repeated in this list', index: 2 },
            ]),
        );
        await click('Save All');
        expect(nameErrors()).toEqual([
            '',
            'A product with this name already exists',
            'Another draft above already uses this name',
        ]);
        document
            .querySelector<HTMLButtonElement>(
                'button[aria-label="Delete draft MILK"]',
            )!
            .click();
        await flush();
        expect(nameErrors()).toEqual([
            'A product with this name already exists',
            '',
        ]);
    });
});

describe('Edit that draft from the dialog (#478)', () => {
    const openNew = async () => {
        await click('Add Product');
        expect(dialog.props.modelValue).toBe(true);
    };
    const idOf = (name: string) =>
        dialog.props.drafts!.find((d) => d.name === name)!.draftId;

    it('passes the drafts and opens the earlier one at once when nothing was typed', async () => {
        await mount(['MILK', 'BREAD']);
        await openNew();
        expect(dialog.props.drafts?.map((d) => d.name)).toEqual([
            'MILK',
            'BREAD',
        ]);
        expect(dialog.props.editingId).toBeNull();
        dialog.editDraft!(idOf('BREAD'), false);
        await flush();
        expect(document.body.textContent).not.toContain('Discard this entry?');
        expect(dialog.props.modelValue).toBe(true);
        expect(dialog.props.item?.name).toBe('BREAD');
        expect(dialog.props.editingId).toBe(idOf('BREAD'));
    });

    it('asks first when typed entries would be discarded', async () => {
        await mount(['MILK']);
        await openNew();
        dialog.editDraft!(idOf('MILK'), true);
        await flush();
        expect(document.body.textContent).toContain('Discard this entry?');
        await click('Keep editing');
        expect(dialog.props.editingId).toBeNull();
        expect(dialog.props.modelValue).toBe(true);

        dialog.editDraft!(idOf('MILK'), true);
        await flush();
        await click('Discard');
        expect(dialog.props.item?.name).toBe('MILK');
        expect(dialog.props.editingId).toBe(idOf('MILK'));
    });
});
