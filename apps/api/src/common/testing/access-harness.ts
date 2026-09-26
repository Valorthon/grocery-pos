/**
 * A real Nest app for per-role access e2e specs, over HTTP with `fetch`.
 * Test-only: excluded from the build (tsconfig.build.json).
 *
 * Boots the given controllers behind the real global JWTAuthGuard,
 * RoleGuard and GlobalFilter, the RequestIdModule (X-Request-Id), with
 * cookie-parser, URI versioning and main.ts's global ValidationPipe
 * (`createValidationPipe`) (the same harness as
 * auth/auth.e2e.spec.ts and product/product.access.e2e.spec.ts). Callers
 * supply the providers behind the controllers, usually real services over
 * faked models.
 */
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
    INestApplication,
    Provider,
    Type,
    VersioningType,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Types } from 'mongoose';
import { JWTAuthGuard } from '../../auth/guards/jwt.guard';
import { RoleGuard } from '../../auth/guards/role.guard';
import { JWTStrategy } from '../../auth/jwt.strategy';
import { Role } from '../../auth/types';
import { useBodyParsers } from '../body-parsers';
import { GlobalFilter } from '../global/global.filter';
import { createValidationPipe } from '../pipes/validation.pipe';
import { RequestIdModule } from '../request-id/request-id';
import { TypedConfigService } from '../typed-config/typed-config.service';

const COOKIE_SECRET = 'access-harness-cookie-secret-0123456789';
const JWT_SECRET = 'access-harness-jwt-secret-0123456789abcd';

/** Every role a user can hold, for role-matrix specs. */
export const ALL_ROLES = [
    Role.Seller,
    Role.Restocker,
    Role.Adjuster,
    Role.UserManager,
    Role.Admin,
];

export interface Caller {
    userId: string;
    roles: Role[];
}

export interface AccessHarness {
    app: INestApplication;
    /** Sends a request to `/v1${path}` signed in as `caller`. */
    call(
        caller: Caller,
        method: 'GET' | 'POST' | 'PATCH',
        path: string,
        body?: unknown,
        headers?: Record<string, string>,
    ): Promise<Response>;
    close(): Promise<void>;
}

/** A caller with a fresh user id. */
export function caller(...roles: Role[]): Caller {
    return { userId: new Types.ObjectId().toString(), roles };
}

/** cookie-parser's signed format: `s:<value>.<base64 HMAC-SHA256>`. */
function signCookie(value: string): string {
    const mac = createHmac('sha256', COOKIE_SECRET)
        .update(value)
        .digest('base64')
        .replace(/=+$/, '');
    return encodeURIComponent(`s:${value}.${mac}`);
}

export async function bootAccessHarness(
    controllers: Type<unknown>[],
    providers: Provider[],
    config: Record<string, unknown> = {},
): Promise<AccessHarness> {
    const values: Record<string, unknown> = {
        APP_ENV: 'test',
        COOKIE_SECRET,
        JWT_SECRET,
        STORE_TIMEZONE: 'Asia/Manila',
        ...config,
    };

    const moduleRef = await Test.createTestingModule({
        imports: [JwtModule.register({}), RequestIdModule],
        controllers,
        providers: [
            JWTStrategy,
            ...providers,
            {
                provide: TypedConfigService,
                useValue: { get: (key: string) => values[key] },
            },
            { provide: APP_GUARD, useClass: JWTAuthGuard },
            { provide: APP_GUARD, useClass: RoleGuard },
            { provide: APP_FILTER, useClass: GlobalFilter },
        ],
    }).compile();

    const app = moduleRef.createNestApplication({
        logger: false,
        bodyParser: false,
    });
    useBodyParsers(app);
    app.useGlobalPipes(createValidationPipe());
    app.use(cookieParser(COOKIE_SECRET));
    app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');

    const server = app.getHttpServer() as Server;
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/v1`;
    const jwt = app.get(JwtService);

    return {
        app,
        call(who, method, path, body, headers = {}) {
            const token = jwt.sign(
                { userId: who.userId, username: 'user', roles: who.roles },
                { secret: JWT_SECRET, expiresIn: 600 },
            );
            return fetch(`${base}${path}`, {
                method,
                headers: {
                    cookie: `jwt=${signCookie(token)}`,
                    'content-type': 'application/json',
                    ...headers,
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        },
        close: () => app.close(),
    };
}
