/**
 * The real app over a real MongoDB replica set, for the DB suite (issue #30).
 *
 * `bootDbApp` boots the production `AppModule` (every module, the real
 * Mongoose models and indexes, the global guards, filter and
 * `createValidationPipe`) against a throwaway database on MONGO_URI_TEST,
 * serves it over HTTP on a random port, and drops the database on `close`.
 * Nothing is mocked. Requests are signed with a JWT cookie, like the access
 * harness, so no user or login is needed: the JWT strategy trusts a signed
 * token without reading the database.
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import mongoose, { Connection, Model, Types } from 'mongoose';
import {
    gtinCheckDigit,
    PaymentType,
    TenderType,
} from '@grocery-pos/contracts';
import { AppModule } from '../../src/app.module';
import { Role } from '../../src/auth/types';
import { useBodyParsers } from '../../src/common/body-parsers';
import { createValidationPipe } from '../../src/common/pipes/validation.pipe';
import { DB_PREFIX, uriWithDb } from './db-uri';

const COOKIE_SECRET = process.env.COOKIE_SECRET!;
const JWT_SECRET = process.env.JWT_SECRET!;

export interface Caller {
    userId: string;
    username: string;
    roles: Role[];
}

export function caller(username: string, ...roles: Role[]): Caller {
    return { userId: new Types.ObjectId().toString(), username, roles };
}

/** This spec file's throwaway database (named by setup-env.ts). */
export function dbName(): string {
    const name = process.env.DB_SUITE_DB_NAME;
    if (!name?.startsWith(DB_PREFIX)) {
        throw new Error('DB_SUITE_DB_NAME is not set: run through test:db');
    }
    return name;
}

/** cookie-parser's signed format: `s:<value>.<base64 HMAC-SHA256>`. */
function signCookie(value: string): string {
    const mac = createHmac('sha256', COOKIE_SECRET)
        .update(value)
        .digest('base64')
        .replace(/=+$/, '');
    return encodeURIComponent(`s:${value}.${mac}`);
}

/**
 * Seeds a database directly through the driver, before the app boots, so
 * the collections the app itself writes first stay cold.
 */
export async function withRawDb<T>(
    fn: (db: mongoose.mongo.Db) => Promise<T>,
): Promise<T> {
    const conn = await mongoose
        .createConnection(uriWithDb(process.env.MONGO_URI_TEST!, dbName()))
        .asPromise();
    try {
        return await fn(conn.db!);
    } finally {
        await conn.close();
    }
}

export interface DbApp {
    app: INestApplication;
    connection: Connection;
    /** Sends a request to `/v1${path}` signed in as `who`. */
    call(
        who: Caller,
        method: 'GET' | 'POST' | 'PATCH',
        path: string,
        body?: unknown,
    ): Promise<Response>;
    model<T>(name: string): Model<T>;
    /** Closes the app and drops its database. */
    close(): Promise<void>;
}

/**
 * Boots AppModule on this file's throwaway database. Mirrors main.ts: the
 * global ValidationPipe, signed cookies and URI versioning. Boot it once
 * per spec file: the env (and so the database) is fixed at import.
 */
export async function bootDbApp(): Promise<DbApp> {
    const name = dbName();

    const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication({
        logger: ['error'],
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
    const connection = app.get<Connection>(getConnectionToken());

    // The guard against dropping anything but the throwaway database.
    if (connection.db?.databaseName !== name) {
        await app.close();
        throw new Error(
            `Connected to ${connection.db?.databaseName}, expected ${name}`,
        );
    }

    return {
        app,
        connection,
        call(who, method, path, body) {
            const token = jwt.sign(
                {
                    userId: who.userId,
                    username: who.username,
                    roles: who.roles,
                },
                { secret: JWT_SECRET, expiresIn: 600 },
            );
            return fetch(`${base}${path}`, {
                method,
                headers: {
                    cookie: `jwt=${signCookie(token)}`,
                    'content-type': 'application/json',
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        },
        model<T>(name: string) {
            return app.get<Model<T>>(getModelToken(name));
        },
        async close() {
            // App first, database second: dropped while the app was still
            // up, a late write (e.g. Mongoose finishing a background index
            // build) could recreate a collection and leave the database
            // behind. `withRawDb` only ever opens this file's database.
            try {
                await app.close();
            } finally {
                await withRawDb((raw) => raw.dropDatabase());
            }
        },
    };
}

let eanSeq = 0;

/** A unique, valid EAN-13 outside the store's generated 200… range. */
export function nextEan(): string {
    eanSeq++;
    const body = `480${String(Date.now() % 1e5).padStart(5, '0')}${String(eanSeq).padStart(4, '0')}`;
    return `${body}${gtinCheckDigit(body)}`;
}

/** A product priced `price` centavos with `stock` units in inventory. */
export function productDocs(
    price: number,
    stock: number,
    updatedBy = new Types.ObjectId(),
) {
    const _id = new Types.ObjectId();
    const now = new Date();
    return {
        product: {
            _id,
            EAN: nextEan(),
            name: `item ${_id.toString()}`,
            price,
            createdAt: now,
            updatedAt: now,
        },
        inventory: {
            _id: new Types.ObjectId(),
            product: _id,
            stock,
            updatedBy,
            createdAt: now,
            updatedAt: now,
        },
    };
}

/** Inserts a product and its inventory row through the app's models. */
export async function seedProduct(
    db: DbApp,
    price: number,
    stock: number,
): Promise<string> {
    const { product, inventory } = productDocs(price, stock);
    await db.model('Product').create(product);
    await db.model('Inventory').create(inventory);
    return product._id.toString();
}

/** The stock of `product`'s inventory row. */
export async function stockOf(db: DbApp, product: string): Promise<number> {
    const row = await db
        .model<{ stock: number }>('Inventory')
        .findOne({ product: new Types.ObjectId(product) })
        .lean();
    if (!row) throw new Error(`No inventory row for ${product}`);
    return row.stock;
}

/** A ₱1,000 opening count. */
export const FLOAT_COUNTS = { '1000': 1 };

/** Opens a shift for `who` over HTTP and returns its id. */
export async function openShift(db: DbApp, who: Caller): Promise<string> {
    const res = await db.call(who, 'POST', '/shifts', {
        counts: FLOAT_COUNTS,
    });
    if (res.status !== 201) {
        throw new Error(`open shift: ${res.status} ${await res.text()}`);
    }
    return ((await res.json()) as { _id: string })._id;
}

/** An exact-cash `POST /sales` body for `quantity` of `product`. */
export function cashSale(
    product: string,
    quantity: number,
    total: number,
    idempotencyKey: string = randomUUID(),
) {
    return {
        idempotencyKey,
        paymentType: PaymentType.CASH,
        tenders: [{ type: TenderType.CASH, amount: total }],
        sellDetails: [{ product, quantity }],
    };
}

/** A GCash `POST /sales` body with `referenceNumber`. */
export function gcashSale(
    product: string,
    quantity: number,
    total: number,
    referenceNumber: string,
    idempotencyKey: string = randomUUID(),
) {
    return {
        idempotencyKey,
        paymentType: PaymentType.GCASH,
        referenceNumber,
        tenders: [{ type: TenderType.GCASH, amount: total }],
        sellDetails: [{ product, quantity }],
    };
}

/** Status and parsed body of a response. */
export async function read<T = Record<string, unknown>>(
    res: Response,
): Promise<{ status: number; body: T }> {
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
