import { describe, expect, it } from 'vitest';
import { STRING_LIMITS } from '@grocery-pos/contracts';
import { PASSWORD_HINT, passwordError } from './rules';

describe('passwordError (the API password policy, #12)', () => {
    const min = STRING_LIMITS.PASSWORD_MIN;

    it('shows the minimum length', () => {
        expect(PASSWORD_HINT).toBe(`At least ${min} characters`);
    });

    it('rejects a password shorter than the minimum', () => {
        expect(passwordError('x'.repeat(min - 1))).toBe(PASSWORD_HINT);
        expect(passwordError('x'.repeat(min))).toBe('');
    });

    it('rejects one longer than the maximum', () => {
        expect(passwordError('x'.repeat(STRING_LIMITS.PASSWORD + 1))).not.toBe(
            '',
        );
    });

    it('requires a value unless optional', () => {
        expect(passwordError('')).not.toBe('');
        expect(passwordError('', true)).toBe('');
        expect(passwordError('short', true)).toBe(PASSWORD_HINT);
    });
});
