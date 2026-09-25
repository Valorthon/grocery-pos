import { isAxiosError } from 'axios';
import type { AppErrorResponse } from '@grocery-pos/contracts';

export const NETWORK_ERROR_MESSAGE =
    'Could not reach the server. Check the connection and try again.';

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose =>
    typeof v === 'object' && v !== null;

const nonEmpty = (v: unknown): v is string =>
    typeof v === 'string' && v.trim() !== '';

/**
 * One line per entry of an error body's `details`, when it holds a list
 * the user can act on (issue #8):
 * - `{ messages }`: the ValidationPipe's messages;
 * - `[{ property, msg, index? }]`: a duplicate key (DB_DUPLICATE_KEY);
 * - `[{ field, message }]`: a database validation failure;
 * - `[string]`: e.g. `ensureValid`'s "name already exists".
 */
function detailMessages(details: unknown): string[] {
    if (isObject(details) && Array.isArray(details.messages)) {
        return details.messages.filter(nonEmpty);
    }
    if (!Array.isArray(details)) return [];

    return details.flatMap((d: unknown): string[] => {
        if (nonEmpty(d)) return [d];
        if (!isObject(d)) return [];
        if (nonEmpty(d.property) && nonEmpty(d.msg)) {
            const line =
                typeof d.index === 'number' ? `Item ${d.index + 1}: ` : '';
            return [`${line}${d.property}: ${d.msg}`];
        }
        if (nonEmpty(d.field) && nonEmpty(d.message)) {
            return [`${d.field}: ${d.message}`];
        }
        return [];
    });
}

/**
 * What to show for a failed API call, as one toast per line: the server's
 * detail list when it sent one, else its `message` (always a string since
 * #8), else `fallback`. A request that got no response is a network error.
 */
export function apiErrorMessages(
    error: unknown,
    fallback = 'Something went wrong. Please try again.',
): string[] {
    if (!isAxiosError(error)) return [fallback];
    if (!error.response) return [NETWORK_ERROR_MESSAGE];

    const data = error.response.data as Partial<AppErrorResponse> | undefined;
    if (!isObject(data)) return [fallback];

    const details = detailMessages(data.details);
    if (details.length > 0) return details;
    if (nonEmpty(data.message)) return [data.message];
    return [fallback];
}
