/**
 * main.ts's CORS options over real HTTP: a cross-origin browser client can
 * read `X-Request-Id` only if the response exposes it.
 */
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { REQUEST_ID_HEADER } from '@grocery-pos/contracts';
import { corsOptions } from './cors';
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

    it('keeps the allowed methods', () => {
        expect(corsOptions(FRONTEND).methods).toEqual([
            'GET',
            'POST',
            'PATCH',
            'OPTIONS',
        ]);
    });
});
