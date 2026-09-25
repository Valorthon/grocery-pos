import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import {
    readSidebarCollapsed,
    sidebarStorageKey,
    useSidebarPreference,
    writeSidebarCollapsed,
} from './useSidebarPreference';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('seller sidebar preference (#26)', () => {
    it('starts expanded when nothing is stored', () => {
        expect(readSidebarCollapsed('u1')).toBe(false);
        expect(useSidebarPreference(() => 'u1').collapsed.value).toBe(false);
    });

    it('is keyed per user, like the basket', () => {
        expect(sidebarStorageKey('u1')).toBe('grocery_pos_sidebar_v1:u1');
    });

    it('remembers a collapse for that user only', () => {
        const pref = useSidebarPreference(() => 'u1');
        pref.toggle();
        expect(pref.collapsed.value).toBe(true);
        expect(localStorage.getItem('grocery_pos_sidebar_v1:u1')).toBe(
            'collapsed',
        );

        // The next page load, for the same user and another one.
        expect(useSidebarPreference(() => 'u1').collapsed.value).toBe(true);
        expect(useSidebarPreference(() => 'u2').collapsed.value).toBe(false);

        pref.toggle();
        expect(localStorage.getItem('grocery_pos_sidebar_v1:u1')).toBe(
            'expanded',
        );
        expect(useSidebarPreference(() => 'u1').collapsed.value).toBe(false);
    });

    it('follows the signed-in user', async () => {
        writeSidebarCollapsed('u1', true);
        const user = ref<string | undefined>('u2');
        const pref = useSidebarPreference(() => user.value);
        expect(pref.collapsed.value).toBe(false);
        user.value = 'u1';
        await nextTick();
        expect(pref.collapsed.value).toBe(true);
    });

    it('stores nothing without a user id', () => {
        const pref = useSidebarPreference(() => undefined);
        pref.toggle();
        expect(pref.collapsed.value).toBe(true);
        expect(localStorage.length).toBe(0);
    });

    it('falls back to expanded when storage cannot be read', () => {
        localStorage.setItem('grocery_pos_sidebar_v1:u1', 'collapsed');
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('blocked', 'SecurityError');
        });
        expect(readSidebarCollapsed('u1')).toBe(false);
        expect(useSidebarPreference(() => 'u1').collapsed.value).toBe(false);
    });

    it('keeps working when storage cannot be written', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        const pref = useSidebarPreference(() => 'u1');
        expect(() => pref.toggle()).not.toThrow();
        expect(pref.collapsed.value).toBe(true);
    });
});
