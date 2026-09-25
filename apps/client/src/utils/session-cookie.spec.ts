import { describe, expect, it } from 'vitest';
import { hasSessionMarker } from './session-cookie';

describe('hasSessionMarker (#21)', () => {
    it.each([
        ['dummy=true', true],
        ['a=1; dummy=true; b=2', true],
        ['a=1;dummy=true', true],
        ['', false],
        ['dummy=', false],
        ['dummy', false],
        ['dummy_analytics=1', false],
        ['xdummy=true', false],
        ['theme=dummy', false],
    ])('%j -> %s', (cookies, expected) => {
        expect(hasSessionMarker(cookies)).toBe(expected);
    });
});
