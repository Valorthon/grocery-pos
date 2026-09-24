import { envSchema } from './validation.env';

const BASE_ENV = {
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    DATABASE_URL: 'mongodb://127.0.0.1:27017/grocery',
    COOKIE_SECRET: 'secret',
    JWT_SECRET: 'secret',
    JWT_EXPIRY_S: '900',
    REFRESH_EXPIRY_S: '604800',
    EAN_COUNTER_ID: 'EAN_COUNTER_ID',
    EAN_COUNTER_DIGITS: '9',
    SANITATION_EXCLUDES: 'password',
    HEALTH_HEAP_THRESHOLD: '1',
    HEALTH_RSS_THRESHOLD: '1',
    HEALTH_DISK_THRESHOLD_PERCENT: '0.9',
    HEALTH_DISK_PATH: '/',
};

describe('envSchema.STORE_TIMEZONE', () => {
    it('defaults to Asia/Manila', () => {
        const parsed = envSchema.parse(BASE_ENV);

        expect(parsed.STORE_TIMEZONE).toBe('Asia/Manila');
    });

    it('accepts another IANA zone', () => {
        const parsed = envSchema.parse({
            ...BASE_ENV,
            STORE_TIMEZONE: 'America/New_York',
        });

        expect(parsed.STORE_TIMEZONE).toBe('America/New_York');
    });

    it('rejects an unknown zone', () => {
        const result = envSchema.safeParse({
            ...BASE_ENV,
            STORE_TIMEZONE: 'Asia/Atlantis',
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['STORE_TIMEZONE']);
    });
});
