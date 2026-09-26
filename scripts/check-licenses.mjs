// License gate (#28): fails when any installed dependency of any workspace
// package (prod and dev) can only be used under a denied license.
//
// `pnpm licenses list` walks the whole workspace, so unlike license-checker
// at the root it sees every package in pnpm's non-flat node_modules.
import { execFileSync } from 'node:child_process';
import { DENIED_DESCRIPTION, isDenied } from './license-policy.mjs';

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
    console.error(`Denied licenses (${DENIED_DESCRIPTION}):`);
    for (const d of denied) console.error(`  ${d}`);
    process.exit(1);
}
