import { describe, expect, it, vi } from 'vitest';
import {
    clearDraftsRequest,
    newDraftId,
    unsavedDrafts,
    useDraftList,
} from './useDrafts';

vi.mock('@/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe('useDraftList (issue #19)', () => {
    it('gives each row its own id, even when every field is the same', () => {
        const { items, add } = useDraftList<{ EAN: string }>();
        add({ EAN: '' });
        add({ EAN: '' });

        const [a, b] = items.value;
        expect(a.draftId).not.toBe(b.draftId);
    });

    it('keeps the id through an edit and changes only that row', () => {
        const { items, add, replace } = useDraftList<{ name: string }>();
        add({ name: 'first' });
        const second = add({ name: 'second' });

        replace(second.draftId, { name: 'edited' });

        expect(items.value.map((d) => d.name)).toEqual(['first', 'edited']);
        expect(items.value[1].draftId).toBe(second.draftId);
    });

    it('does not let an edit swap the id for another', () => {
        const { items, add, replace } = useDraftList<{ name: string }>();
        const first = add({ name: 'first' });

        replace(first.draftId, {
            name: 'edited',
            draftId: 'other',
        } as { name: string });

        expect(items.value[0].draftId).toBe(first.draftId);
    });

    it('removes only the row with that id', () => {
        const { items, add, remove } = useDraftList<{ name: string }>();
        const first = add({ name: 'same' });
        add({ name: 'same' });

        remove(first.draftId);

        expect(items.value).toHaveLength(1);
        expect(items.value[0].draftId).not.toBe(first.draftId);
    });

    it('clears every row', () => {
        const { items, add, clear } = useDraftList<{ name: string }>();
        add({ name: 'a' });
        clear();
        expect(items.value).toEqual([]);
    });

    it('never repeats an id', () => {
        const ids = new Set(Array.from({ length: 50 }, newDraftId));
        expect(ids.size).toBe(50);
    });
});

describe('draft wording', () => {
    it('counts drafts in plain words', () => {
        expect(unsavedDrafts(1)).toBe('1 unsaved draft');
        expect(unsavedDrafts(3)).toBe('3 unsaved drafts');
        expect(clearDraftsRequest(1).message).toBe(
            'Clear the 1 draft? This cannot be undone.',
        );
        expect(clearDraftsRequest(4).message).toBe(
            'Clear all 4 drafts? This cannot be undone.',
        );
    });
});
