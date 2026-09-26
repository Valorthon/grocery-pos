// Run by `pnpm licenses:check` (node --test) before the scan itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDenied } from './license-policy.mjs';

test('denies GPL and AGPL in any spelling or version', () => {
    for (const id of [
        'GPL',
        'GPLv2',
        'GPLv3',
        'gpl-3.0',
        'GPL-2.0',
        'GPL-2.0-only',
        'GPL-3.0-or-later',
        'GPL-3.0+',
        'AGPL-1.0',
        'AGPL-3.0-only',
        'agplv3',
        'GPL-2.0 WITH Classpath-exception-2.0',
    ]) {
        assert.equal(isDenied(id), true, id);
    }
});

test('allows LGPL and permissive licenses', () => {
    for (const id of [
        'LGPL-2.1',
        'LGPL-3.0-or-later',
        'MIT',
        'Apache-2.0',
        'BSD-3-Clause',
        'Unknown',
        'Apache-2.0 WITH LLVM-exception',
    ]) {
        assert.equal(isDenied(id), false, id);
    }
});

test('an allowed alternative is enough; AND needs every part allowed', () => {
    assert.equal(isDenied('(MIT OR GPL-3.0)'), false);
    assert.equal(isDenied('MIT OR Apache-2.0 AND GPL-3.0'), false);
    assert.equal(isDenied('(GPL-2.0 OR GPL-3.0)'), true);
    assert.equal(isDenied('MIT AND GPL-2.0'), true);
    assert.equal(isDenied('(MIT OR Apache-2.0) AND GPL-3.0'), true);
    assert.equal(isDenied('(MIT OR CC0-1.0)'), false);
});

test('fails closed on an expression that does not parse', () => {
    for (const expr of [
        'MIT OR (GPL-2.0',
        'MIT OR (Apache-2.0',
        'MIT)',
        'MIT OR',
        'AND MIT',
        '()',
        '',
        'MIT Apache-2.0',
        'MIT WITH',
    ]) {
        assert.equal(isDenied(expr), true, JSON.stringify(expr));
    }
});
