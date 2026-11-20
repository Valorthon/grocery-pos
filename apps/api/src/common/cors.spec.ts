/**
 * main.ts's CORS options over real HTTP: a cross-origin browser client can
 * read `X-Request-Id` only if the response exposes it.
 */
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { REQUEST_ID_HEADER } from '@grocery-pos/contracts';
import { corsFor, corsOptions } from './cors';
import { RequestIdModule } from './request-id/request-id';

const FRONTEND = 'https://pos.example.com';

@Controller('probe')
class ProbeController {
    @Get()
    get() {
        return { ok: true };
    }
}

describe('corsOptions', () => {
    let app: INestApplication;
    let base: string;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [RequestIdModule],
            controllers: [ProbeController],
        }).compile();
        app = moduleRef.createNestApplication({ logger: false });
        app.enableCors(corsOptions(FRONTEND));
        await app.listen(0, '127.0.0.1');
        const { port } = app.getHttpServer().address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
        await app.close();
    });

    it('exposes X-Request-Id to the frontend origin', async () => {
        const res = await fetch(`${base}/probe`, {
            headers: { origin: FRONTEND },
        });

        expect(res.headers.get('access-control-allow-origin')).toBe(FRONTEND);
        expect(res.headers.get('access-control-allow-credentials')).toBe(
            'true',
        );
        expect(
            res.headers
                .get('access-control-expose-headers')
                ?.split(',')
                .map((h) => h.trim().toLowerCase()),
        ).toContain(REQUEST_ID_HEADER.toLowerCase());
        expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    });

    it('allows the manager approval header in a credentialed frontend preflight', async () => {
        const res = await fetch(`${base}/probe`, {
            method: 'OPTIONS',
            headers: {
                origin: FRONTEND,
                'access-control-request-method': 'POST',
                'access-control-request-headers':
                    'content-type,x-manager-approval',
            },
        });
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-credentials')).toBe(
            'true',
        );
        expect(
            res.headers.get('access-control-allow-headers')?.toLowerCase(),
        ).toContain('x-manager-approval');
    });

    it('keeps the allowed methods', () => {
        expect(corsOptions(FRONTEND).methods).toEqual([
            'GET',
            'POST',
            'PATCH',
            'OPTIONS',
        ]);
    });
});

describe('corsFor with a single-pc LAN origin (#394)', () => {
    const LOCAL = 'https://localhost:1443';
    const LAN = 'https://192.168.1.10:1443';
    let app: INestApplication;
    let base: string;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ProbeController],
        }).compile();
        app = moduleRef.createNestApplication({ logger: false });
        app.enableCors(corsFor(LOCAL, LAN));
        await app.listen(0, '127.0.0.1');
        const { port } = app.getHttpServer().address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
        await app.close();
    });

    function allowOrigin(host: string, origin: string): Promise<string | null> {
        return new Promise((resolve, reject) => {
            const url = new URL(`${base}/probe`);
            const req = request(
                {
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    headers: { host, origin },
                },
                (res) => {
                    res.resume();
                    const value = res.headers['access-control-allow-origin'];
                    resolve(typeof value === 'string' ? value : null);
                },
            );
            req.on('error', reject);
            req.end();
        });
    }

    it('allows each origin only on its own host', async () => {
        await expect(allowOrigin('192.168.1.10:1443', LAN)).resolves.toBe(LAN);
        await expect(allowOrigin('localhost:1443', LOCAL)).resolves.toBe(LOCAL);
        // A fixed allowed origin is sent as is; the browser refuses the mismatch.
        await expect(allowOrigin('localhost:1443', LAN)).resolves.not.toBe(LAN);
        await expect(allowOrigin('192.168.1.10:1443', LOCAL)).resolves.not.toBe(
            LOCAL,
        );
        await expect(
            allowOrigin('192.168.1.11:1443', 'https://192.168.1.11:1443'),
        ).resolves.not.toBe('https://192.168.1.11:1443');
    });

    it('keeps the static options without a LAN origin', () => {
        expect(corsFor(LOCAL)).toEqual(corsOptions(LOCAL));
    });
});
