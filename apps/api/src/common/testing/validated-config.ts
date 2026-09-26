import { TypedConfigService } from '../typed-config/typed-config.service';
import {
    EXAMPLE_COOKIE_SECRET,
    EXAMPLE_JWT_SECRET,
    validateEnv,
} from '../typed-config/validation.env';

/**
 * A dev environment with no DOMAIN at all: what `docker run` with a few
 * `-e` flags and no `--env-file` gives (#91).
 */
export const DEV_ENV_WITHOUT_DOMAIN: Readonly<Record<string, string>> = {
    APP_ENV: 'dev',
    FRONTEND_URL: 'http://localhost:5173',
    DATABASE_URL: 'mongodb://127.0.0.1:27017/grocery',
    COOKIE_SECRET: EXAMPLE_COOKIE_SECRET,
    JWT_SECRET: EXAMPLE_JWT_SECRET,
    JWT_EXPIRY_S: '900',
    REFRESH_EXPIRY_S: '604800',
    EAN_COUNTER_ID: 'EAN_COUNTER_ID',
    EAN_COUNTER_DIGITS: '9',
    HEALTH_HEAP_THRESHOLD: '1',
    HEALTH_RSS_THRESHOLD: '1',
    HEALTH_DISK_THRESHOLD_PERCENT: '0.9',
    HEALTH_DISK_PATH: '/',
};

/**
 * The real TypedConfigService over `validateEnv`'s output, as the app gets
 * it. ConfigService falls back to process.env for keys the validated config
 * lacks, so callers testing an unset key must keep it out of process.env.
 */
export function validatedConfig(
    env: Record<string, unknown>,
): TypedConfigService {
    return new TypedConfigService(validateEnv(env, () => undefined));
}
