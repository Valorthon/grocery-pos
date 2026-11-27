import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    resetTerminalIdForTests,
    terminalId,
    TERMINAL_ID_STORAGE_KEY,
} from './terminal-id';

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetTerminalIdForTests();
});

describe('terminalId (#509)', () => {
    it('creates one id per browser and keeps it across page loads and cashiers', () => {
        const id = terminalId();
        expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
        expect(localStorage.getItem(TERMINAL_ID_STORAGE_KEY)).toBe(id);
        resetTerminalIdForTests();
        expect(terminalId()).toBe(id);
    });

    it('replaces a malformed stored id', () => {
        localStorage.setItem(TERMINAL_ID_STORAGE_KEY, 'bad id!');
        expect(terminalId()).not.toBe('bad id!');
    });

    it('keeps a page-lifetime id when storage fails', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });
        const id = terminalId();
        expect(terminalId()).toBe(id);
    });
});
