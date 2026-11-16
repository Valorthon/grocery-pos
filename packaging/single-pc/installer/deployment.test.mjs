// Exercise the real pinned pnpm against a local registry that publishes a newer
// allowed version after locking. No public registry or shared cache is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtemp,
    mkdir,
    readFile,
    rm,
    writeFile,
    lstat,
    readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { dependencyLicenses } from './bundle.mjs';

// A minimal npm tarball (ustar header + package.json + terminator).
function tarball(manifest) {
    const body = Buffer.from(JSON.stringify(manifest));
    const header = Buffer.alloc(512);
    header.write('package/package.json');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return gzipSync(
        Buffer.concat([
            header,
            body,
            Buffer.alloc(((512 - (body.length % 512)) % 512) + 1024),
        ]),
    );
}

function command(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: {
                ...Object.fromEntries(
                    Object.entries(process.env).filter(
                        ([key]) =>
                            !/^(npm_config_|npm_package_|pnpm_)/i.test(key),
                    ),
                ),
                HUSKY: '0',
                CI: 'true',
            },
            shell: process.platform === 'win32' && command === 'pnpm',
        });
        let output = '';
        child.stdout.on('data', (d) => {
            output += d;
        });
        child.stderr.on('data', (d) => {
            output += d;
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, output }));
    });
}

async function noLinks(dir) {
    for (const name of await readdir(dir)) {
        const path = join(dir, name);
        const info = await lstat(path);
        assert.equal(info.isSymbolicLink(), false, path);
        if (info.isDirectory()) await noLinks(path);
    }
}

test(
    'deployment enforces locked ranges, overrides, peers and workspace builds with clean and cached stores',
    { timeout: 120000 },
    async (t) => {
        const dir = await mkdtemp(join(tmpdir(), 'gpos-deploy-test-'));
        t.after(() => rm(dir, { recursive: true, force: true }));
        let newer = false;
        const server = createServer((req, res) => {
            const name = req.url.split('/')[1];
            const manifests = ['1.0.0', '1.1.0'].map((version) => ({
                name,
                version,
                license: 'MIT',
                ...(name === 'ranged'
                    ? {
                          dependencies: { child: '^1.0.0' },
                          peerDependencies: { peer: '^1.0.0' },
                      }
                    : {}),
            }));
            if (req.url.includes('.tgz')) {
                const manifest = manifests.find((m) =>
                    req.url.endsWith(`${m.version}.tgz`),
                );
                res.end(tarball(manifest));
            } else {
                res.setHeader('Content-Type', 'application/json');
                res.end(
                    JSON.stringify({
                        name,
                        time: {
                            '1.0.0': '2020-01-01T00:00:00Z',
                            '1.1.0': '2020-01-02T00:00:00Z',
                        },
                        'dist-tags': { latest: newer ? '1.1.0' : '1.0.0' },
                        versions: Object.fromEntries(
                            manifests.slice(0, newer ? 2 : 1).map((m) => [
                                m.version,
                                {
                                    ...m,
                                    dist: {
                                        tarball: `${registry}${name}/-/${name}-${m.version}.tgz`,
                                        integrity:
                                            'sha512-' +
                                            createHash('sha512')
                                                .update(tarball(m))
                                                .digest('base64'),
                                    },
                                },
                            ]),
                        ),
                    }),
                );
            }
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        t.after(() => new Promise((resolve) => server.close(resolve)));
        const registry = `http://127.0.0.1:${server.address().port}/`;
        const json = async (path, value) =>
            writeFile(path, JSON.stringify(value));
        await mkdir(join(dir, 'apps', 'api'), { recursive: true });
        await mkdir(join(dir, 'packages', 'contracts', 'dist'), {
            recursive: true,
        });
        await json(join(dir, 'package.json'), {
            private: true,
            pnpm: { overrides: { child: '1.0.0' } },
        });
        await writeFile(join(dir, '.npmrc'), `registry=${registry}\n`);
        await writeFile(
            join(dir, 'pnpm-workspace.yaml'),
            'packages:\n  - apps/*\n  - packages/*\ninjectWorkspacePackages: true\nstoreDir: ./store\n',
        );
        const manifest = {
            name: 'grocery-pos-api',
            version: '1.0.0',
            dependencies: {
                ranged: '^1.0.0',
                peer: '^1.0.0',
                '@grocery-pos/contracts': 'workspace:*',
            },
            devDependencies: { 'dev-only': '^1.0.0' },
        };
        await json(join(dir, 'apps', 'api', 'package.json'), manifest);
        await json(join(dir, 'packages', 'contracts', 'package.json'), {
            name: '@grocery-pos/contracts',
            version: '1.0.0',
            files: ['dist'],
            main: 'dist/index.js',
        });
        await writeFile(
            join(dir, 'packages', 'contracts', 'dist', 'index.js'),
            'module.exports = 42;\n',
        );
        const lock = await command(
            'pnpm',
            ['install', '--lockfile-only', '--ignore-scripts'],
            dir,
        );
        assert.equal(lock.code, 0, lock.output);
        const sourceLock = await readFile(join(dir, 'pnpm-lock.yaml'), 'utf8');
        newer = true;
        // Start deployment with an empty store, then repeat against its populated cache.
        const module = pathToFileURL(
            join(import.meta.dirname, 'bundle.mjs'),
        ).href;
        const runner = join(dir, 'deploy.mjs');
        await writeFile(
            runner,
            `import { deployProduction } from ${JSON.stringify(module)}; deployProduction(process.argv[2], ${JSON.stringify(dir)});`,
        );
        const deploy = (dest) => command(process.execPath, [runner, dest], dir);
        const inventories = [];
        for (const name of ['clean', 'cached']) {
            const destination = join(dir, name);
            const result = await deploy(destination);
            assert.equal(result.code, 0, result.output);
            assert.doesNotMatch(
                result.output,
                /legacy deploy|prohibits to read or write a lockfile/,
            );
            const modules = join(destination, 'node_modules');
            inventories.push(await dependencyLicenses(modules));
            assert.deepEqual(
                inventories.at(-1).map((p) => `${p.name}@${p.version}`),
                [
                    '@grocery-pos/contracts@1.0.0',
                    'child@1.0.0',
                    'peer@1.0.0',
                    'ranged@1.0.0',
                ],
            );
            const ranged = JSON.parse(
                await readFile(join(modules, 'ranged', 'package.json'), 'utf8'),
            );
            assert.equal(ranged.peerDependencies.peer, '^1.0.0');
            assert.equal(
                await readFile(
                    join(modules, '@grocery-pos/contracts/dist/index.js'),
                    'utf8',
                ),
                'module.exports = 42;\n',
            );
            // .bin launchers are never shipped by the bundle.
            await rm(join(modules, '.bin'), { recursive: true, force: true });
            await noLinks(modules);
            const deployedLock = await readFile(
                join(modules, '.pnpm', 'lock.yaml'),
                'utf8',
            );
            for (const pkg of ['child', 'peer', 'ranged']) {
                const integrity =
                    'sha512-' +
                    createHash('sha512')
                        .update(
                            tarball({
                                name: pkg,
                                version: '1.0.0',
                                license: 'MIT',
                                ...(pkg === 'ranged'
                                    ? {
                                          dependencies: { child: '^1.0.0' },
                                          peerDependencies: { peer: '^1.0.0' },
                                      }
                                    : {}),
                            }),
                        )
                        .digest('base64');
                assert.ok(sourceLock.includes(integrity), pkg);
                assert.ok(deployedLock.includes(integrity), pkg);
            }
        }
        assert.deepEqual(inventories[0], inventories[1]);
        assert.equal(
            await readFile(join(dir, 'pnpm-lock.yaml'), 'utf8'),
            sourceLock,
        );
        manifest.dependencies.ranged = '^2.0.0';
        await json(join(dir, 'apps', 'api', 'package.json'), manifest);
        const refused = await deploy(join(dir, 'stale'));
        assert.notEqual(refused.code, 0);
        assert.match(refused.output, /OUTDATED_LOCKFILE/);
    },
);
