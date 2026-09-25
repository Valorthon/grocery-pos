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

/**
 * The field names of `dup key: { name: "Milk", EAN: "..." }` in a server
 * error message. Only the field names are taken, never the values.
 */
function keysFromMessage(errmsg: unknown): string[] {
    if (typeof errmsg !== 'string') return [];
    const body = /dup key: \{(.*)\}/s.exec(errmsg)?.[1];
    if (!body) return [];
    return [...body.matchAll(/(?:^|,)\s*"?([\w.$]+)"?\s*:/g)].map((m) => m[1]);
}

/** Field names from `keyPattern` (server 4.4+), else from the message. */
function duplicateFields(err: Loose): string[] {
    if (isObject(err.keyPattern)) {
        const keys = Object.keys(err.keyPattern);
        if (keys.length > 0) return keys;
    }
    const response = isObject(err.errorResponse) ? err.errorResponse : {};
    return keysFromMessage(err.errmsg ?? response.errmsg ?? err.message);
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

/** Mongoose `ValidationError`: `errors` maps each path to its failure. */
function mongooseValidationDetails(err: Loose): ValidationDetail[] {
    const errors = isObject(err.errors) ? err.errors : {};
    return Object.entries(errors).map(([field, e]) => ({
        field,
        message:
            isObject(e) && typeof e.message === 'string'
                ? e.message
                : 'Invalid value',
    }));
}

/** Server-side `$jsonSchema` failure (code 121). */
function documentValidationDetails(err: Loose): ValidationDetail[] | null {
    const response = isObject(err.errorResponse) ? err.errorResponse : {};
    const list = response.validationErrors;
    if (!Array.isArray(list)) return null;
    return list.filter(isObject).map((v) => ({
        field: str(v.path, 'unknown'),
        message: str(v.message, 'Invalid value'),
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
 * message is only read to recover field names the driver leaves out).
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
                    message: `Invalid value for ${str(e.kind, 'this field')}`,
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
