// License policy for scripts/check-licenses.mjs (#28). Kept apart so
// license-policy.test.mjs can check it without running `pnpm licenses`.

/** Shown when the check fails. */
export const DENIED_DESCRIPTION = 'GPL or AGPL, any version (LGPL is allowed)';

/**
 * Any bare or versioned GPL or AGPL id, in any case: GPL, GPLv3,
 * gpl-3.0, GPL-2.0-only, GPL-3.0+, AGPL-1.0, AGPL-3.0-or-later. LGPL
 * does not match (it starts with L).
 */
const DENIED_ID = /^a?gpl(?:[-v+\d.].*)?$/i;

export function isDeniedId(id) {
    return DENIED_ID.test(id);
}

/**
 * True when an SPDX expression leaves no way to take the package under
 * allowed licenses only: `(MIT OR GPL-3.0)` passes; `GPL-3.0` and
 * `MIT AND GPL-2.0` fail. AND binds tighter than OR, as in SPDX; `X WITH
 * exception` is judged by X. An expression that does not parse (empty,
 * unbalanced parentheses, a dangling operator) fails closed.
 */
export function isDenied(expression) {
    const tokens = String(expression).match(/\(|\)|[^\s()]+/g) ?? [];
    const isOperator = (t) => /^(AND|OR|WITH)$/i.test(t ?? '');
    let i = 0;
    const fail = () => {
        throw new Error(`Unparseable license expression: ${expression}`);
    };
    // Each parser returns whether its part can be satisfied with allowed
    // licenses only.
    const primary = () => {
        const token = tokens[i++];
        if (token === undefined || token === ')' || isOperator(token)) fail();
        if (token === '(') {
            const ok = anyOf();
            if (tokens[i++] !== ')') fail();
            return ok;
        }
        if (/^WITH$/i.test(tokens[i] ?? '')) {
            i++;
            const exception = tokens[i++];
            if (
                exception === undefined ||
                /^[()]$/.test(exception) ||
                isOperator(exception)
            ) {
                fail();
            }
        }
        return !isDeniedId(token);
    };
    const allOf = () => {
        let ok = primary();
        while (/^AND$/i.test(tokens[i] ?? '')) {
            i++;
            ok = primary() && ok;
        }
        return ok;
    };
    const anyOf = () => {
        let ok = allOf();
        while (/^OR$/i.test(tokens[i] ?? '')) {
            i++;
            ok = allOf() || ok;
        }
        return ok;
    };
    try {
        const ok = anyOf();
        if (i !== tokens.length) fail();
        return !ok;
    } catch {
        return true;
    }
}
