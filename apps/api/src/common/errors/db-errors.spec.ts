import { classifyDbError, fieldsFromIndexName } from './db-errors';

const dup = (index: string, key: string) =>
    `E11000 duplicate key error collection: pos.products index: ${index} dup key: ${key}`;

describe('fieldsFromIndexName (issue #8)', () => {
    it.each([
        ['name_1', ['name']],
        ['cashier_1_status_1', ['cashier', 'status']],
        ['status_1_openedAt_-1', ['status', 'openedAt']],
        ['created_at_1', ['created_at']],
        ['name_text', ['name']],
        ['idempotencyKey_1', ['idempotencyKey']],
    ])('reads %s', (index, fields) => {
        expect(fieldsFromIndexName(dup(index, '{ x: 1 }'))).toEqual(fields);
    });

    it('never reads the dup key values, even when they look like keys', () => {
        const msg = dup('name_1', '{ name: "Milk, promo: 2 } x" }');

        expect(fieldsFromIndexName(msg)).toEqual(['name']);
    });

    it('ignores a collation suffix', () => {
        const msg = `${dup('name_1', '{ name: "milk" }')}, collation: { locale: "en", strength: 2 }`;

        expect(fieldsFromIndexName(msg)).toEqual(['name']);
    });

    it('gives nothing for a custom index name', () => {
        expect(fieldsFromIndexName(dup('uniqueOpenShift', '{ x: 1 }'))).toEqual(
            [],
        );
    });

    it('gives nothing without an index name', () => {
        expect(fieldsFromIndexName('E11000 duplicate key error')).toEqual([]);
        expect(fieldsFromIndexName(undefined)).toEqual([]);
    });
});

describe('classifyDbError on bulk duplicates (issue #8)', () => {
    function bulk(errmsg: string) {
        return Object.assign(new Error(errmsg), {
            name: 'MongoBulkWriteError',
            code: 11000,
            writeErrors: [
                { err: { index: 3, code: 11000, errmsg, op: { name: 'x' } } },
            ],
        });
    }

    it('takes the fields from the index name, with no value text', () => {
        const err = classifyDbError(
            bulk(
                `${dup('name_1', '{ name: "Milk, promo: 2 } x" }')}, collation: { locale: "en" }`,
            ),
        );

        expect(err?.details).toEqual([
            { msg: 'Already exists', property: 'name', index: 3 },
        ]);
        const json = JSON.stringify(err?.details);
        for (const leak of ['Milk', 'promo', 'collation', 'locale']) {
            expect(json).not.toContain(leak);
        }
    });

    it('lists every field of a compound index', () => {
        const err = classifyDbError(
            bulk(
                dup(
                    'cashier_1_status_1',
                    '{ cashier: ObjectId(\'a\'), status: "OPEN" }',
                ),
            ),
        );

        expect(err?.details).toEqual([
            { msg: 'Already exists', property: 'cashier', index: 3 },
            { msg: 'Already exists', property: 'status', index: 3 },
        ]);
    });

    it('says unknown for a custom index name', () => {
        const err = classifyDbError(bulk(dup('uniqueName', '{ name: "a" }')));

        expect(err?.details).toEqual([
            { msg: 'Already exists', property: 'unknown', index: 3 },
        ]);
    });
});

describe('classifyDbError on other driver shapes (issue #30)', () => {
    const mongoError = (props: Record<string, unknown>) =>
        Object.assign(new Error('driver error'), {
            name: 'MongoServerError',
            ...props,
        });

    it('reads the fields from errorResponse.errmsg when keyPattern is missing', () => {
        // Some driver paths (e.g. a commit) keep the server reply only in
        // errorResponse; the field must still be named, never the value.
        const err = classifyDbError(
            mongoError({
                code: 11000,
                errorResponse: {
                    errmsg: dup(
                        'referenceNumber_1',
                        '{ referenceNumber: "0912" }',
                    ),
                },
            }),
        );
        expect(err?.details).toEqual([
            { msg: 'Already exists', property: 'referenceNumber' },
        ]);
        expect(JSON.stringify(err?.details)).not.toContain('0912');
    });

    it('accepts writeErrors as a single object rather than an array', () => {
        // Older drivers (and `OneOrMore<WriteError>` typings) hand back one
        // WriteError as an object; it must still name the field.
        const err = classifyDbError(
            Object.assign(new Error('bulk'), {
                code: 11000,
                name: 'MongoBulkWriteError',
                writeErrors: {
                    code: 11000,
                    index: 1,
                    keyPattern: { EAN: 1 },
                },
            }),
        );
        expect(err?.statusCode).toBe(400);
        expect(err?.details).toEqual([
            { msg: 'Already exists', property: 'EAN', index: 1 },
        ]);
    });

    it('answers server document validation (code 121) with the failing paths only', () => {
        const err = classifyDbError(
            mongoError({
                code: 121,
                errorResponse: {
                    validationErrors: [
                        { path: 'price', message: 'must be an integer' },
                        { path: 3 },
                        'not an object',
                    ],
                },
            }),
        );
        expect(err?.details).toEqual([
            { field: 'price', message: 'must be an integer' },
            { field: '3', message: 'Invalid value' },
        ]);
    });

    it('gives no details for a code 121 without validationErrors', () => {
        const err = classifyDbError(mongoError({ code: 121 }));
        expect(err?.statusCode).toBe(400);
        expect(err?.details).toBeNull();
    });

    it('leaves other Mongo errors (a write conflict) unclassified: a 500', () => {
        expect(classifyDbError(mongoError({ code: 112 }))).toBeNull();
    });
});
