// Marks each build output with its module format so Node resolves it correctly
// regardless of the root package.json "type" field.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
writeFileSync(join(dist, 'cjs', 'package.json'), '{"type":"commonjs"}\n');
writeFileSync(join(dist, 'esm', 'package.json'), '{"type":"module"}\n');
