import { AppError } from './app-error';
import { ErrorCode } from './codes';

/** MongoDB's duplicate-key error code (a unique index clash). */
export const MONGO_DUPLICATE_KEY = 11000;
/** MongoDB's `$jsonSchema` document validation failure. */
export const MONGO_DOCUMENT_VALIDATION = 121;

const DUPLICATE_MESSAGE = 'Already exists';

export interface DuplicateKeyDetail {
    msg: string;
    /** The clashing field, or `unknown` when the driver did not say. */
    property: string;
    /** Position of the clashing document in a bulk insert. */
    index?: number;
}

export interface ValidationDetail {
    field: string;
    message: string;
}

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose =>
    typeof v === 'object' && v !== null;

const str = (v: unknown, fallback: string): string =>
    typeof v === 'string' || typeof v === 'number' ? String(v) : fallback;

/** Index key directions/types that end each field in a default index name. */
const INDEX_KEY_TYPES = new Set([
    '1',
    '-1',
    'text',
    'hashed',
    '2d',
    '2dsphere',
]);

/**
 * The field names of a unique index from its default name in a server
 * error message: `index: name_1` → `name`, `index: cashier_1_status_1` →
 * `cashier`, `status`. The `dup key: { ... }` part is never read: it holds
 * the clashing values, and a value can contain text that looks like a key.
 * A custom index name that does not follow the `<field>_<type>` pattern
 * yields nothing (the caller reports `unknown`).
 */
export function fieldsFromIndexName(errmsg: unknown): string[] {
    if (typeof errmsg !== 'string') return [];
    const indexName = /\bindex: (\S+) dup key:/.exec(errmsg)?.[1];
    if (!indexName) return [];

    const fields: string[] = [];
    let pending: string[] = [];
    for (const token of indexName.split('_')) {
        if (pending.length > 0 && INDEX_KEY_TYPES.has(token)) {
            fields.push(pending.join('_'));
            pending = [];
        } else {
            pending.push(token);
        }
    }
    // Leftover tokens: not a default name, so no field can be trusted.
    return pending.length === 0 ? fields : [];
}

/** Field names from `keyPattern` (server 4.4+), else from the message. */
function duplicateFields(err: Loose): string[] {
    if (isObject(err.keyPattern)) {
        const keys = Object.keys(err.keyPattern);
        if (keys.length > 0) return keys;
    }
    const response = isObject(err.errorResponse) ? err.errorResponse : {};
    return fieldsFromIndexName(err.errmsg ?? response.errmsg ?? err.message);
}

function duplicateDetails(err: Loose): DuplicateKeyDetail[] {
    // MongoBulkWriteError (insertMany, bulkWrite): one WriteError per
    // clashing document. A WriteError keeps the raw server error in `err`
    // (with `op`, the attempted document, which must never be sent back);
    // only its index and the clashing field names are used.
    const writeErrors = Array.isArray(err.writeErrors)
        ? (err.writeErrors as unknown[])
        : isObject(err.writeErrors)
          ? [err.writeErrors]
          : [];

    const bulk = writeErrors
        .filter(isObject)
        .map((we) => {
            const raw = isObject(we.err) ? we.err : we;
            return { we, raw };
        })
        .filter(
            ({ we, raw }) =>
                Number(raw.code ?? we.code) === MONGO_DUPLICATE_KEY,
        )
        .flatMap(({ we, raw }) => {
            const index = Number(raw.index ?? we.index);
            const fields = duplicateFields(raw);
            return (fields.length > 0 ? fields : ['unknown']).map(
                (property) => ({
                    msg: DUPLICATE_MESSAGE,
                    property,
                    ...(Number.isInteger(index) && { index }),
                }),
            );
        });
    if (bulk.length > 0) return bulk;

    const fields = duplicateFields(err);
    return (fields.length > 0 ? fields : ['unknown']).map((property) => ({
        msg: DUPLICATE_MESSAGE,
        property,
    }));
}

const INVALID_VALUE = 'Invalid value';

/**
 * The client-facing message for one failed path. Only a `validate`
 * message written in our schemas (a ValidatorError of kind
 * `user defined`, e.g. "unitCost must be an integer number of centavos")
 * is passed on. Mongoose's built-in messages (cast, min, enum, ...) echo
 * the submitted value and BSON reasons, so they stay in the log (the
 * original error is the `cause`) and the client gets `Invalid value`.
 */
function pathMessage(e: unknown): string {
    return isObject(e) &&
        e.name === 'ValidatorError' &&
        e.kind === 'user defined' &&
        typeof e.message === 'string'
        ? e.message
        : INVALID_VALUE;
}

/** Mongoose `ValidationError`: `errors` maps each path to its failure. */
function mongooseValidationDetails(err: Loose): ValidationDetail[] {
    const errors = isObject(err.errors) ? err.errors : {};
    return Object.entries(errors).map(([field, e]) => ({
        field,
        message: pathMessage(e),
    }));
}

/** Server-side `$jsonSchema` failure (code 121). */
function documentValidationDetails(err: Loose): ValidationDetail[] | null {
    const response = isObject(err.errorResponse) ? err.errorResponse : {};
    const list = response.validationErrors;
    if (!Array.isArray(list)) return null;
    return list.filter(isObject).map((v) => ({
        field: str(v.path, 'unknown'),
        message: str(v.message, INVALID_VALUE),
    }));
}

/**
 * Classifies a database error as a client error, or returns null when it
 * is not one (the caller then answers 500 and logs it).
 *
 * - duplicate key (code 11000) from a `MongoServerError` or a
 *   `MongoBulkWriteError` → 400 DB_DUPLICATE_KEY, with the clashing field
 *   names only (no values, no attempted documents);
 * - Mongoose `ValidationError` / `CastError` and server document
 *   validation (code 121) → 400 DB_VALIDATION_ERROR.
 *
 * Dispatches on the error `code` and `name`, never on message text (the
 * message is only read for the index name, to recover the field names a
 * bulk write error leaves out).
 * The returned error keeps the original as its `cause`, for the log.
 */
export function classifyDbError(err: unknown): AppError | null {
    if (!(err instanceof Error) || err instanceof AppError) return null;
    const e = err as unknown as Loose;
    const name = err.name;

    if (name === 'ValidationError' && isObject(e.errors)) {
        return new AppError(
            ErrorCode.DB_VALIDATION_ERROR,
            AppError.getHttpStatus(ErrorCode.DB_VALIDATION_ERROR),
            'Document validation failed',
            mongooseValidationDetails(e),
            { cause: err },
        );
    }

    if (name === 'CastError') {
        return new AppError(
            ErrorCode.DB_VALIDATION_ERROR,
            AppError.getHttpStatus(ErrorCode.DB_VALIDATION_ERROR),
            'Document validation failed',
            [
                {
                    field: str(e.path, 'unknown'),
                    message: INVALID_VALUE,
                },
            ],
            { cause: err },
        );
    }

    if (!name.startsWith('Mongo')) return null;

    const code = Number(e.code);
    const bulkCodes = Array.isArray(e.writeErrors)
        ? (e.writeErrors as unknown[])
              .filter(isObject)
              .map((we) =>
                  Number(
                      we.code ?? (isObject(we.err) ? we.err.code : undefined),
                  ),
              )
        : [];

    if (
        code === MONGO_DUPLICATE_KEY ||
        bulkCodes.includes(MONGO_DUPLICATE_KEY)
    ) {
        return new AppError(
            ErrorCode.DB_DUPLICATE_KEY,
            AppError.getHttpStatus(ErrorCode.DB_DUPLICATE_KEY),
            DUPLICATE_MESSAGE,
            duplicateDetails(e),
            { cause: err },
        );
    }

    if (code === MONGO_DOCUMENT_VALIDATION) {
        return new AppError(
            ErrorCode.DB_VALIDATION_ERROR,
            AppError.getHttpStatus(ErrorCode.DB_VALIDATION_ERROR),
            'Document validation failed',
            documentValidationDetails(e),
            { cause: err },
        );
    }

    return null;
}
