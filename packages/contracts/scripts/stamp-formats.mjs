// Marks each build output with its module format so Node resolves it correctly
// regardless of the root package.json "type" field.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
writeFileSync(join(dist, 'cjs', 'package.json'), '{"type":"commonjs"}\n');
writeFileSync(join(dist, 'esm', 'package.json'), '{"type":"module"}\n');

// tsc copies import specifiers as written. Node's ESM loader needs the file
// named (`./roles.js`); only bundlers guess a bare `./roles`. Fail the build
// on one, so dist/esm stays loadable by plain Node (issue #27).
const esm = join(dist, 'esm');
const jsFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
            ? jsFiles(join(dir, entry.name))
            : entry.name.endsWith('.js')
              ? [join(dir, entry.name)]
              : [],
    );
const bare = jsFiles(esm).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/from '(\.{1,2}\/[^']*)'/g)]
        .map((match) => match[1])
        .filter((spec) => !spec.endsWith('.js'))
        .map((spec) => `${relative(esm, file)}: ${spec}`),
);
if (bare.length > 0) {
    throw new Error(
        `Relative imports without a .js extension (write './x.js' in src):\n  ${bare.join('\n  ')}`,
    );
}
