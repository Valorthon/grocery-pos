// The release Caddyfile with a real Caddy (#396): the localhost site and the
// generated LAN site. Needs GPOS_TEST_CADDY (a caddy binary, the version in
// components.json) and a private IPv4 address on a local network adapter;
// skipped otherwise. Ports are moved off 1443/13000 so it runs beside an
// installation.
//
//   GPOS_TEST_CADDY=/path/to/caddy pnpm test:single-pc-caddy
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect, createServer as netServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import { after, before, describe, test } from 'node:test';
import { boundedWait } from '../proof/policy.mjs';
import { caddyLanSite, isPrivateIpv4 } from '../runtime/layout.mjs';

const CADDY = process.env.GPOS_TEST_CADDY;
const LAN_IP = Object.values(networkInterfaces())
    .flat()
    .find((a) => a?.family === 'IPv4' && isPrivateIpv4(a.address))?.address;

async function freePort() {
    const server = netServer().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    server.close();
    await once(server, 'close');
    return port;
}

function listening(host, port) {
    return new Promise((done) => {
        const socket = netConnect({ host, port });
        socket.once('connect', () => {
            socket.destroy();
            done(true);
        });
        socket.once('error', () => done(false));
    });
}

function get(
    host,
    port,
    path,
    { ca, headers = {}, servername, insecure = false } = {},
) {
    return new Promise((done, fail) => {
        const req = httpsRequest(
            {
                host,
                port,
                path,
                ca,
                headers,
                servername,
                rejectUnauthorized: !insecure,
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () =>
                    done({
                        status: res.statusCode,
                        headers: res.headers,
                        body,
                    }),
                );
            },
        );
        req.on('error', fail);
        req.end();
    });
}

describe(
    'the release Caddyfile on a real Caddy (#396)',
    { skip: !CADDY || !LAN_IP },
    () => {
        let dir;
        let caddy;
        let api;
        let ca;
        let port;
        const seen = [];

        before(async () => {
            dir = await mkdtemp(join(tmpdir(), 'gpos-caddy-'));
            port = await freePort();
            api = createServer((req, res) => {
                seen.push({
                    url: req.url,
                    host: req.headers.host,
                    xff: req.headers['x-forwarded-for'],
                });
                res.end(`api ${req.url}`);
            }).listen(0, '127.0.0.1');
            await once(api, 'listening');
            const config = join(dir, 'config');
            const client = join(dir, 'client');
            await mkdir(config);
            await mkdir(client);
            await writeFile(join(client, 'index.html'), 'the app');
            const text = (
                await readFile(new URL('./Caddyfile', import.meta.url), 'utf8')
            )
                .replaceAll(':1443', `:${port}`)
                .replace('127.0.0.1:13000', `127.0.0.1:${api.address().port}`);
            await writeFile(join(dir, 'Caddyfile'), text);
            await writeFile(
                join(config, 'lan-site.caddy'),
                caddyLanSite(LAN_IP).replace(':1443', `:${port}`),
            );
            caddy = spawn(
                CADDY,
                [
                    'run',
                    '--config',
                    join(dir, 'Caddyfile'),
                    '--adapter',
                    'caddyfile',
                ],
                {
                    env: {
                        ...process.env,
                        XDG_DATA_HOME: join(dir, 'data'),
                        XDG_CONFIG_HOME: join(dir, 'conf'),
                        GPOS_CONFIG_DIR: config,
                        GPOS_CLIENT_ROOT: client,
                    },
                    stdio: 'ignore',
                },
            );
            await boundedWait(() => listening(LAN_IP, port), {
                timeoutMs: 20_000,
                intervalMs: 200,
            });
            const root = join(
                dir,
                'data',
                'caddy',
                'pki',
                'authorities',
                'local',
                'root.crt',
            );
            await boundedWait(
                async () => (ca = await readFile(root).catch(() => undefined)),
                { timeoutMs: 20_000, intervalMs: 200 },
            );
        });

        after(async () => {
            caddy?.kill();
            if (caddy) await once(caddy, 'exit').catch(() => {});
            api?.close();
            if (dir) await rm(dir, { recursive: true, force: true });
        });

        test('the LAN site serves the app and the API with its IP certificate', async () => {
            // Node sends no SNI to an IP address, as Chrome does not.
            const app = await get(LAN_IP, port, '/', { ca });
            assert.equal(app.status, 200);
            assert.equal(app.body, 'the app');
            assert.equal(
                app.headers['reporting-endpoints'],
                'csp-endpoint="/v1/csp-report"',
            );
            const apiAnswer = await get(LAN_IP, port, '/v1/x', {
                ca,
                headers: { 'X-Forwarded-For': '6.6.6.6' },
            });
            assert.equal(apiAnswer.body, 'api /v1/x');
            const call = seen.at(-1);
            assert.equal(call.host, `${LAN_IP}:${port}`);
            // Caddy replaces a client-sent X-Forwarded-For with the peer.
            assert.equal(call.xff, LAN_IP);

            const socket = tlsConnect({ host: LAN_IP, port, ca });
            await once(socket, 'secureConnect');
            assert.match(
                socket.getPeerCertificate().subjectaltname,
                new RegExp(`IP Address:${LAN_IP.replaceAll('.', '\\.')}`),
            );
            socket.destroy();
        });

        test('health is refused on the LAN site but not on localhost', async () => {
            const before = seen.length;
            for (const path of ['/v1/health', '/v1/health/ready'])
                assert.equal(
                    (await get(LAN_IP, port, path, { ca })).status,
                    404,
                );
            assert.equal(seen.length, before, 'never proxied');
            const local = await get('127.0.0.1', port, '/v1/health/ready', {
                ca,
                servername: 'localhost',
                headers: { Host: `localhost:${port}` },
            });
            assert.equal(local.body, 'api /v1/health/ready');
        });

        test('the localhost site is not served on the LAN listener', async () => {
            const before = seen.length;
            const spoofed = await get(LAN_IP, port, '/v1/x', {
                insecure: true,
                servername: 'localhost',
                headers: { Host: `localhost:${port}` },
            });
            assert.equal(spoofed.body, '');
            assert.equal(seen.length, before, 'never proxied');
        });
    },
);
