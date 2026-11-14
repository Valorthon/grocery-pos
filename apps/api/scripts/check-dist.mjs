// Fails the API build when its entry point is not where the Dockerfile
// (`node apps/api/dist/main.js`) and `start:prod` (`node dist/main`) run it.
// A TS file outside src/ once pulled tsc's rootDir up a level, moving the
// output to dist/src/ without any error (#30 review).
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/main.js', import.meta.url))) {
    console.error(
        'apps/api/dist/main.js is missing: the build output moved (check rootDir/include in tsconfig.build.json).',
    );
    process.exit(1);
}

// The operator's first-install command (#361) ships compiled, never via ts-node.
if (
    !existsSync(
        new URL('../dist/bootstrap/initial-admin.cli.js', import.meta.url),
    )
) {
    console.error(
        'apps/api/dist/bootstrap/initial-admin.cli.js is missing: the bootstrap command must ship in the build.',
    );
    process.exit(1);
}
