import { parseClientEnv } from '@/config/validation.env';

const parsedEnv = parseClientEnv(import.meta.env);

if (!parsedEnv.success) {
    throw new Error('Env validation failed');
}

// vite.config.ts already warned at build/dev-server start; repeat it in the
// dev browser console, where it is easier to notice.
if (parsedEnv.warning && import.meta.env.DEV) {
    console.warn(parsedEnv.warning);
}

export const env = parsedEnv.data;
