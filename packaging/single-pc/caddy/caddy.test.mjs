// The release Caddy configuration with a real Caddy (#396): the localhost
// service (Caddyfile) and the LAN service (Caddyfile.lan) as two processes
// sharing one TLS storage, as installed. Needs GPOS_TEST_CADDY (a caddy binary, the version in
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
import { createSocket } from 'node:dgram';
import { connect as tlsConnect } from 'node:tls';
import { after, before, describe, test } from 'node:test';
import { boundedWait } from '../proof/policy.mjs';
import { isPrivateIpv4 } from '../runtime/layout.mjs';

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
    'the release Caddy services on a real Caddy (#396)',
    { skip: !CADDY || !LAN_IP },
    () => {
        let dir;
        let env;
        let caddy;
        let lanCaddy;
        const start = (file, environment) =>
            spawn(
                CADDY,
                ['run', '--config', join(dir, file), '--adapter', 'caddyfile'],
                { env: environment, stdio: 'ignore' },
            );
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
            // A space, like C:\Program Files (the 2026-11-21 Windows install test).
            const client = join(dir, 'client root');
            await mkdir(client);
            await writeFile(join(client, 'index.html'), 'the app');
            // The release files, moved off the real ports.
            for (const name of ['Caddyfile', 'Caddyfile.lan', 'app.caddy'])
                await writeFile(
                    join(dir, name),
                    (
                        await readFile(
                            new URL(`./${name}`, import.meta.url),
                            'utf8',
                        )
                    )
                        .replaceAll(':1443', `:${port}`)
                        .replace(
                            '127.0.0.1:13000',
                            `127.0.0.1:${api.address().port}`,
                        ),
                );
            env = {
                ...process.env,
                // One TLS storage for both services, as installed.
                XDG_DATA_HOME: join(dir, 'data'),
                XDG_CONFIG_HOME: join(dir, 'conf'),
                GPOS_CLIENT_ROOT: client,
            };
            caddy = start('Caddyfile', env);
            await boundedWait(() => listening('127.0.0.1', port), {
                timeoutMs: 20_000,
                intervalMs: 200,
            });
            lanCaddy = start('Caddyfile.lan', { ...env, GPOS_LAN_IP: LAN_IP });
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
            for (const child of [lanCaddy, caddy]) {
                if (!child || child.exitCode !== null) continue;
                child.kill();
                await once(child, 'exit').catch(() => {});
            }
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

        test('neither site offers HTTP/3 or holds UDP on its port (#508)', async () => {
            for (const [host, servername] of [
                [LAN_IP, undefined],
                ['127.0.0.1', 'localhost'],
            ]) {
                const answer = await get(host, port, '/', {
                    ca,
                    servername,
                    headers: servername ? { Host: `localhost:${port}` } : {},
                });
                assert.equal(answer.headers['alt-svc'], undefined, host);
                // A UDP bind succeeds only if Caddy holds no QUIC socket.
                const udp = createSocket('udp4');
                await new Promise((done, fail) => {
                    udp.once('error', fail);
                    udp.bind(port, host, done);
                });
                udp.close();
            }
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
            // The LAN service has no localhost site: with SNI localhost the
            // handshake fails; with the LAN certificate and Host localhost
            // no site matches. Neither reaches the API.
            await assert.rejects(
                get(LAN_IP, port, '/v1/x', {
                    insecure: true,
                    servername: 'localhost',
                    headers: { Host: `localhost:${port}` },
                }),
            );
            const spoofed = await get(LAN_IP, port, '/v1/x', {
                ca,
                // No SNI, as for an IP (Node would take it from Host).
                servername: '',
                headers: { Host: `localhost:${port}` },
            });
            assert.equal(spoofed.body, '');
            assert.equal(seen.length, before, 'never proxied');
        });

        test('the localhost service keeps serving when the LAN address is absent', async () => {
            // A second LAN service on an address this PC does not have (the
            // cable is out): it fails to bind and exits; SCM would retry it.
            const absent = [
                '10.255.254.253',
                '172.31.254.253',
                '192.168.254.253',
            ].find(
                (ip) =>
                    !Object.values(networkInterfaces())
                        .flat()
                        .some((a) => a?.address === ip),
            );
            const failing = start('Caddyfile.lan', {
                ...env,
                GPOS_LAN_IP: absent,
            });
            const [code] = await once(failing, 'exit');
            assert.notEqual(code, 0);
            const local = await get('127.0.0.1', port, '/', {
                ca,
                servername: 'localhost',
                headers: { Host: `localhost:${port}` },
            });
            assert.equal(local.body, 'the app');
            assert.equal(caddy.exitCode, null, 'the localhost service runs');
        });
    },
);
