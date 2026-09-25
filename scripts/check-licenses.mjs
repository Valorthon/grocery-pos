// License gate (#28): fails when any installed dependency of any workspace
// package (prod and dev) can only be used under a denied license.
//
// `pnpm licenses list` walks the whole workspace, so unlike license-checker
// at the root it sees every package in pnpm's non-flat node_modules.
import { execFileSync } from 'node:child_process';

const DENIED = ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0'];

/** `GPL-3.0-only`, `GPL-3.0-or-later` and `GPL-3.0+` all count as `GPL-3.0`. */
function baseId(id) {
    return id.replace(/(-only|-or-later|\+)$/, '');
}

/**
 * True when an SPDX expression leaves no way to take the package under
 * allowed licenses only: `(MIT OR GPL-3.0)` passes, `GPL-3.0` and
 * `MIT AND GPL-2.0` fail. AND binds tighter than OR, as in SPDX.
 */
function isDenied(expression) {
    const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
    let i = 0;
    // Each parser returns whether its part can be satisfied with allowed
    // licenses only.
    const primary = () => {
        const token = tokens[i++];
        if (token === '(') {
            const ok = anyOf();
            i++; // ')'
            return ok;
        }
        return !DENIED.includes(baseId(token ?? ''));
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
    return !anyOf();
}

const report = JSON.parse(
    execFileSync('pnpm', ['licenses', 'list', '--json'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    }),
);

let scanned = 0;
const denied = [];
const unknown = [];
for (const [license, pkgs] of Object.entries(report)) {
    for (const pkg of pkgs) {
        scanned += pkg.versions.length;
        const ids = pkg.versions.map((v) => `${pkg.name}@${v}`);
        if (isDenied(license))
            denied.push(...ids.map((id) => `${id} (${license})`));
        else if (license === 'Unknown') unknown.push(...ids);
    }
}

const summary = Object.entries(report)
    .map(([license, pkgs]) => `${license}: ${pkgs.length}`)
    .join(', ');
console.log(`Scanned ${scanned} packages. ${summary}`);
if (unknown.length) {
    console.log(`No license field (check by hand): ${unknown.join(', ')}`);
}
if (denied.length) {
    console.error(`Denied licenses (${DENIED.join(', ')}):`);
    for (const d of denied) console.error(`  ${d}`);
    process.exit(1);
}
