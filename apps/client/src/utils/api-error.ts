import { isAxiosError } from 'axios';
import { type AppErrorResponse, ErrorCode } from '@grocery-pos/contracts';

export const NETWORK_ERROR_MESSAGE =
    'Could not reach the server. Check the connection and try again.';

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose =>
    typeof v === 'object' && v !== null;

const nonEmpty = (v: unknown): v is string =>
    typeof v === 'string' && v.trim() !== '';

const ERROR_CODES = new Set<unknown>(Object.values(ErrorCode));

/**
 * The API's error body (contracts `AppErrorResponse`) of a failed request,
 * or null: no response (network), or a body without a known `ErrorCode`
 * (e.g. a proxy's HTML page). Only `error` is checked, so read the other
 * fields defensively.
 */
export function apiErrorBody(error: unknown): AppErrorResponse | null {
    if (!isAxiosError(error)) return null;
    const data: unknown = error.response?.data;
    return isObject(data) && ERROR_CODES.has(data.error)
        ? (data as unknown as AppErrorResponse)
        : null;
}

/**
 * The API's `ErrorCode` for a failed request (issue #27), or undefined
 * when there is none (see `apiErrorBody`). Branch on this, not on the
 * status or the message, when the reason matters (e.g. SHIFT_NOT_OPEN).
 */
export function apiErrorCode(error: unknown): ErrorCode | undefined {
    return apiErrorBody(error)?.error;
}

export interface ApiErrorOptions {
    /**
     * The 0-based line of the caller's list for a position in a bulk
     * insert. Duplicate-key and invalid-barcode details count only the
     * products being inserted: for `POST /restocks` that is the new-product
     * lines alone, so the caller maps them back (`newProductLines`).
     * Defaults to the position itself, as for `POST /products/bulk`.
     */
    insertLine?: (index: number) => number;
}

/** "Item N: " for a 0-based line, or nothing without one. */
const itemPrefix = (line: unknown): string =>
    typeof line === 'number' && Number.isInteger(line)
        ? `Item ${line + 1}: `
        : '';

/**
 * One line per entry of an error body's `details`, when it holds a list
 * the user can act on (issue #8):
 * - `{ messages }`: the ValidationPipe's messages;
 * - `[{ property, msg, index? }]`: a duplicate key (DB_DUPLICATE_KEY),
 *   `index` being the position in the bulk insert;
 * - `[{ index, EAN, message }]`: an invalid barcode among the products
 *   being inserted (VALIDATION_EAN_INVALID), indexed the same way;
 * - `[{ product, name, change, available }]`: an adjustment that would
 *   take stock below zero;
 * - `[{ field, message }]`: a database validation failure;
 * - `[{ product, index? }]`: PRODUCT_NOT_FOUND, `index` being the line of
 *   the request (a restock) when given;
 * - `[string]`: e.g. `ensureValid`'s "name already exists".
 */
function detailMessages(details: unknown, options: ApiErrorOptions): string[] {
    if (isObject(details) && Array.isArray(details.messages)) {
        return details.messages.filter(nonEmpty);
    }
    if (!Array.isArray(details)) return [];

    const insertLine = (index: unknown): unknown =>
        typeof index === 'number' && options.insertLine
            ? options.insertLine(index)
            : index;

    return details.flatMap((d: unknown): string[] => {
        if (nonEmpty(d)) return [d];
        if (!isObject(d)) return [];
        if (nonEmpty(d.property) && nonEmpty(d.msg)) {
            const prefix = itemPrefix(insertLine(d.index));
            // `unknown`: the driver did not name the clashing field.
            const field = d.property === 'unknown' ? '' : `${d.property}: `;
            return [`${prefix}${field}${d.msg}`];
        }
        if ('EAN' in d && nonEmpty(d.message)) {
            return [`${itemPrefix(insertLine(d.index))}${d.message}`];
        }
        if (typeof d.available === 'number') {
            const name = nonEmpty(d.name) ? d.name : 'A product';
            return [`${name}: only ${d.available} in stock`];
        }
        if (nonEmpty(d.field) && nonEmpty(d.message)) {
            return [`${d.field}: ${d.message}`];
        }
        if (nonEmpty(d.product)) {
            const prefix = itemPrefix(d.index);
            return [
                prefix ? `${prefix}product not found` : 'Product not found',
            ];
        }
        return [];
    });
}

/**
 * What to show for a failed API call, as one toast per line: the server's
 * detail list when it sent one, else its `message` (always a string since
 * #8), else `fallback`. A request that got no response is a network error.
 * Anything that is not an axios error is logged with `console.error`.
 */
export function apiErrorMessages(
    error: unknown,
    fallback = 'Something went wrong. Please try again.',
    options: ApiErrorOptions = {},
): string[] {
    if (!isAxiosError(error)) {
        // Not a failed request but a bug (e.g. a malformed row): the user
        // sees the fallback, and the console keeps it diagnosable.
        console.error(error);
        return [fallback];
    }
    if (!error.response) return [NETWORK_ERROR_MESSAGE];

    const data = error.response.data as Partial<AppErrorResponse> | undefined;
    if (!isObject(data)) return [fallback];

    const details = detailMessages(data.details, options);
    if (details.length > 0) return details;
    if (nonEmpty(data.message)) return [data.message];
    return [fallback];
}

/**
 * `apiErrorMessages` as one line, for a single inline error (a list-fetch
 * error state or a modal's error line).
 */
export function apiErrorText(
    error: unknown,
    fallback?: string,
    options?: ApiErrorOptions,
): string {
    return apiErrorMessages(error, fallback, options).join('; ');
}
