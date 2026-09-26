/**
 * Runs before each DB spec file is loaded (jest `setupFiles`), because
 * AppModule's ConfigModule validates the env when it is imported.
 *
 * Each spec file gets its own throwaway database, named here and dropped by
 * `DbApp.close` (db-app.ts).
 */
import { randomBytes } from 'node:crypto';
import { DB_PREFIX, uriWithDb } from './db-uri';

const uri = process.env.MONGO_URI_TEST;
if (!uri) throw new Error('MONGO_URI_TEST is not set');

// Mongo database names are at most 63 bytes.
const dbName =
    `${DB_PREFIX}${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`.slice(
        0,
        63,
    );

Object.assign(process.env, {
    DB_SUITE_DB_NAME: dbName,
    APP_ENV: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    DATABASE_URL: uriWithDb(uri, dbName),
    DOMAIN: '',
    COOKIE_SECRET: 'db-suite-cookie-secret-0123456789abcdef',
    JWT_SECRET: 'db-suite-jwt-secret-0123456789abcdef0123',
    JWT_EXPIRY_S: '900',
    REFRESH_EXPIRY_S: '604800',
    EAN_COUNTER_ID: 'EAN_COUNTER_ID',
    EAN_COUNTER_DIGITS: '9',
    HEALTH_HEAP_THRESHOLD: String(1024 ** 3),
    HEALTH_RSS_THRESHOLD: String(1024 ** 3),
    HEALTH_DISK_THRESHOLD_PERCENT: '0.99',
    HEALTH_DISK_PATH: '/',
    STORE_TIMEZONE: 'Asia/Manila',
});
