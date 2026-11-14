import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
    ShiftStatus,
    UnitOfMeasure,
    type OfflineProduct,
} from '@grocery-pos/contracts';
import {
    activateOfflineLease,
    applyOfflinePage,
    closeOfflineDatabase,
    getOrCreateOfflineState,
    readOfflineMetadata,
    readOfflineState,
    saveOfflineState,
    suspendOffline,
    type OfflineState,
} from './database';
import { seedLegacyOfflineDatabase } from './testing/legacy-database';

const product = (id: string, price = 100): OfflineProduct => ({
    _id: id,
    EAN: id,
    name: id,
    price,
    unit: UnitOfMeasure.PIECE,
    proof: `immutable-proof-${id}-${price}`,
    updatedAt: '2026-11-01T00:00:00.000Z',
});
const state = (owner = 'owner', lease = 'lease'): OfflineState => ({
    owner,
    terminalId: `terminal-${owner}`,
    cursor: null,
    suspended: false,
    products: [product('old')],
    lease: {
        _id: lease,
        cashier: owner,
        cashierName: owner,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        shift: {
            _id: lease,
            status: ShiftStatus.OPEN,
            cashierName: owner,
            terminal: 'A',
            openedAt: new Date().toISOString(),
            openingFloat: 10000,
            movements: [],
        },
    },
});
beforeEach(() => {
    closeOfflineDatabase();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});
afterEach(() => {
    closeOfflineDatabase();
    vi.unstubAllGlobals();
});

it('upgrades owner-isolated legacy catalogues into individual rows and compact metadata', async () => {
    const first = state();
    first.cursor = 'resume-here';
    const second = state('other');
    second.products = [product('old', 250)];
    await seedLegacyOfflineDatabase([first, second]);
    expect(await readOfflineState(first.owner)).toEqual(first);
    expect(await readOfflineState(second.owner)).toEqual(second);
    expect(await readOfflineMetadata(first.owner)).not.toHaveProperty(
        'products',
    );
    closeOfflineDatabase();
    expect(await readOfflineState(first.owner)).toEqual(first);
});

it('commits a page, tombstones and its resume cursor together, retaining other owners', async () => {
    await saveOfflineState(state());
    await saveOfflineState(state('other'));
    expect(
        await applyOfflinePage('owner', 'lease', null, {
            products: [product('a'), product('old', 150)],
            next: 'page-2',
        }),
    ).toBe(true);
    closeOfflineDatabase();
    expect((await readOfflineState('owner'))?.cursor).toBe('page-2');
    expect(
        await applyOfflinePage('owner', 'lease', 'page-2', {
            products: [{ ...product('old'), isActive: false }, product('b')],
            next: null,
        }),
    ).toBe(true);
    expect((await readOfflineState('owner'))?.products).toEqual([
        product('a'),
        product('b'),
    ]);
    expect((await readOfflineState('other'))?.products).toEqual([
        product('old'),
    ]);
    expect((await readOfflineState('owner'))?.cursor).toBe(
        `${product('b').updatedAt}|b`,
    );
});

it('rolls back page writes and cursor when a later product hits a quota failure, then resumes', async () => {
    const initial = state();
    await saveOfflineState(initial);
    const original = IDBObjectStore.prototype.put;
    const write = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (
            this: IDBObjectStore,
            value: unknown,
            key?: IDBValidKey,
        ) {
            const row = value as { product?: OfflineProduct };
            if (this.name === 'catalogue' && row.product?._id === 'b')
                throw new DOMException('full', 'QuotaExceededError');
            return original.call(this, value, key);
        });
    const page = { products: [product('a'), product('b')], next: 'next' };
    await expect(
        applyOfflinePage('owner', 'lease', null, page),
    ).rejects.toThrow('full');
    write.mockRestore();
    expect(await readOfflineState('owner')).toEqual(initial);
    expect(await applyOfflinePage('owner', 'lease', null, page)).toBe(true);
    expect((await readOfflineState('owner'))?.cursor).toBe('next');
});

it('ignores a late page after another tab advances the cursor', async () => {
    await saveOfflineState(state());
    const page = { products: [product('a')], next: 'next' };
    expect(await applyOfflinePage('owner', 'lease', null, page)).toBe(true);
    expect(
        await applyOfflinePage('owner', 'lease', null, {
            products: [product('a', 999)],
            next: 'stale',
        }),
    ).toBe(false);
    expect(
        (await readOfflineState('owner'))?.products.find((p) => p._id === 'a')
            ?.price,
    ).toBe(100);
    expect((await readOfflineMetadata('owner'))?.cursor).toBe('next');
});

it('checks suspension under the page transaction lock and never resumes a closing lease', async () => {
    await saveOfflineState(state());
    const prior = await getOrCreateOfflineState('owner', () => 'unused');
    const suspending = suspendOffline('owner');
    const updating = applyOfflinePage('owner', 'lease', null, {
        products: [product('new')],
        next: 'next',
    });
    await suspending;
    expect(await updating).toBe(false);
    expect(await activateOfflineLease(prior, state().lease!)).toBeUndefined();
    expect((await readOfflineState('owner'))?.products).toEqual([
        product('old'),
    ]);
    expect((await readOfflineMetadata('owner'))?.suspended).toBe(true);
});

it('atomically resets visibility for a new lease and rejects older lease responses and pages', async () => {
    await saveOfflineState(state());
    const previous = await getOrCreateOfflineState('owner', () => 'unused');
    const next = state('owner', 'next-lease').lease!;
    expect(await activateOfflineLease(previous, next)).toMatchObject({
        cursor: null,
        lease: next,
    });
    expect((await readOfflineState('owner'))?.products).toEqual([]);
    expect(
        await activateOfflineLease(previous, previous.lease!),
    ).toBeUndefined();
    expect(
        await applyOfflinePage('owner', 'lease', null, {
            products: [product('stale')],
            next: null,
        }),
    ).toBe(false);
    expect(
        await applyOfflinePage('owner', 'next-lease', null, {
            products: [product('new')],
            next: null,
        }),
    ).toBe(true);
    expect((await readOfflineState('owner'))?.products).toEqual([
        product('new'),
    ]);
});

it('does not rewrite catalogue or cursor for an empty unchanged delta', async () => {
    await saveOfflineState(state());
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
    expect(
        await applyOfflinePage('owner', 'lease', null, {
            products: [],
            next: null,
        }),
    ).toBe(true);
    expect(writes).not.toHaveBeenCalled();
    expect((await readOfflineState('owner'))?.products).toEqual([
        product('old'),
    ]);
});

it('rolls back catalogue visibility if a lease metadata write fails', async () => {
    const initial = state();
    await saveOfflineState(initial);
    const previous = await getOrCreateOfflineState('owner', () => 'unused');
    const original = IDBObjectStore.prototype.put;
    const writes = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (
            this: IDBObjectStore,
            value: unknown,
            key?: IDBValidKey,
        ) {
            if (this.name === 'state')
                throw new DOMException('full', 'QuotaExceededError');
            return original.call(this, value, key);
        });
    await expect(
        activateOfflineLease(previous, state('owner', 'next').lease!),
    ).rejects.toThrow('full');
    writes.mockRestore();
    expect(await readOfflineState('owner')).toEqual(initial);
});

it('never creates catalogue rows for a missing owner or a mismatched terminal', async () => {
    expect(
        await applyOfflinePage('absent', 'lease', null, {
            products: [product('a')],
            next: null,
        }),
    ).toBe(false);
    const previous = await getOrCreateOfflineState('owner', () => 'terminal');
    expect(
        await activateOfflineLease(
            { ...previous, terminalId: 'other-terminal' },
            state().lease!,
        ),
    ).toBeUndefined();
    expect((await readOfflineState('owner'))?.lease).toBeNull();
});
