import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import {
    apiErrorMessages,
    apiErrorText,
    NETWORK_ERROR_MESSAGE,
} from './api-error';
import { newProductLines } from './payloads';

/** An axios error carrying `data` as the response body. */
function httpError(status: number, data: unknown): AxiosError {
    const config = { headers: new AxiosHeaders() };
    const response = {
        status,
        statusText: '',
        headers: {},
        config,
        data,
    } as AxiosResponse;
    return new AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_REQUEST',
        config,
        {},
        response,
    );
}

/** A GlobalFilter body (issue #8). */
function body(message: string, details: unknown = null) {
    return {
        statusCode: 400,
        error: 'VAL_001',
        message,
        timestamp: '2026-09-25T00:00:00.000Z',
        path: '/v1/products/bulk',
        details,
        requestId: 'req-1',
    };
}

describe('apiErrorMessages', () => {
    it('shows a string message', () => {
        expect(
            apiErrorMessages(httpError(409, body('Shift not open'))),
        ).toEqual(['Shift not open']);
    });

    it("lists the ValidationPipe's messages from details.messages", () => {
        const messages = [
            'newProducts.0.property autoGenerateEAN should not exist',
            'newProducts.0.price must be an integer number',
        ];
        const error = httpError(400, body(messages.join(', '), { messages }));

        expect(apiErrorMessages(error)).toEqual(messages);
    });

    it('names each clashing field of a duplicate key, by line', () => {
        const error = httpError(
            400,
            body('Duplicate key', [
                { msg: 'Already exists', property: 'name', index: 1 },
                { msg: 'Already exists', property: 'EAN' },
            ]),
        );

        expect(apiErrorMessages(error)).toEqual([
            'Item 2: name: Already exists',
            'EAN: Already exists',
        ]);
    });

    it('lists database validation failures', () => {
        const error = httpError(
            400,
            body('Document validation failed', [
                { field: 'price', message: 'Invalid value' },
            ]),
        );

        expect(apiErrorMessages(error)).toEqual(['price: Invalid value']);
    });

    it("lists ensureValid's duplicate fields", () => {
        const error = httpError(
            400,
            body('Duplicate product', ['name already exists']),
        );

        expect(apiErrorMessages(error)).toEqual(['name already exists']);
    });

    it('falls back to the message when details hold nothing to show', () => {
        const error = httpError(400, body('Bad input', { retryAfterS: 3 }));

        expect(apiErrorMessages(error)).toEqual(['Bad input']);
    });

    it('reports a network error when there is no response', () => {
        const error = new AxiosError('Network Error', 'ERR_NETWORK');

        expect(apiErrorMessages(error)).toEqual([NETWORK_ERROR_MESSAGE]);
    });

    it('uses the fallback for a body without a message', () => {
        expect(apiErrorMessages(httpError(502, '<html>'), 'Try again')).toEqual(
            ['Try again'],
        );
        expect(apiErrorMessages(new Error('boom'), 'Try again')).toEqual([
            'Try again',
        ]);
    });

    it('does not name an unknown clashing field', () => {
        const error = httpError(
            400,
            body('Duplicate key', [
                { msg: 'Already exists', property: 'unknown', index: 0 },
            ]),
        );

        expect(apiErrorMessages(error)).toEqual(['Item 1: Already exists']);
    });

    it('numbers an invalid barcode among the inserted products', () => {
        const error = httpError(
            400,
            body('Invalid barcode', [
                { index: 1, EAN: '4006381333932', message: 'Bad check digit' },
            ]),
        );

        expect(apiErrorMessages(error)).toEqual(['Item 2: Bad check digit']);
    });

    it('says how much stock an adjustment would overdraw', () => {
        const error = httpError(
            400,
            body('Adjustment would make stock negative', [
                { product: 'p1', name: 'bread', change: -5, available: 2 },
                { product: 'p2', change: -1, available: 0 },
            ]),
        );

        expect(apiErrorMessages(error)).toEqual([
            'bread: only 2 in stock',
            'A product: only 0 in stock',
        ]);
    });

    it('names the restock line of a product that does not exist', () => {
        const error = httpError(
            404,
            body('One or more products do not exist', [
                { index: 2, product: '507f1f77bcf86cd799439011' },
            ]),
        );

        expect(apiErrorMessages(error)).toEqual(['Item 3: product not found']);
    });

    it('reports a missing product without a line', () => {
        const error = httpError(
            404,
            body('One or more products have no inventory record', [
                { product: '507f1f77bcf86cd799439011' },
            ]),
        );

        expect(apiErrorMessages(error)).toEqual(['Product not found']);
    });

    describe('insert positions (insertLine)', () => {
        // Restock lines: existing, existing, new, new. The API inserts only
        // the two new products, so it reports the second one as index 1.
        const drafts = [
            { isNewProduct: false },
            { isNewProduct: false },
            { isNewProduct: true },
            { isNewProduct: true },
        ];
        const lines = newProductLines(drafts);
        const insertLine = (index: number) => lines[index] ?? index;

        it('maps a restock duplicate key to its draft line', () => {
            const error = httpError(
                400,
                body('Duplicate key', [
                    { msg: 'Already exists', property: 'name', index: 1 },
                ]),
            );

            expect(apiErrorMessages(error, undefined, { insertLine })).toEqual([
                'Item 4: name: Already exists',
            ]);
        });

        it('maps a restock invalid barcode to its draft line', () => {
            const error = httpError(
                400,
                body('Invalid barcode', [
                    { index: 0, EAN: 'x', message: 'Bad check digit' },
                ]),
            );

            expect(apiErrorMessages(error, undefined, { insertLine })).toEqual([
                'Item 3: Bad check digit',
            ]);
        });

        it('leaves a restock not-found line as the request line', () => {
            const error = httpError(
                404,
                body('One or more products do not exist', [
                    { index: 1, product: '507f1f77bcf86cd799439011' },
                ]),
            );

            expect(apiErrorMessages(error, undefined, { insertLine })).toEqual([
                'Item 2: product not found',
            ]);
        });

        it('keeps the position for /products/bulk, where every line is inserted', () => {
            const error = httpError(
                400,
                body('Duplicate key', [
                    { msg: 'Already exists', property: 'name', index: 1 },
                ]),
            );

            expect(apiErrorMessages(error)).toEqual([
                'Item 2: name: Already exists',
            ]);
        });
    });
});

describe('apiErrorText', () => {
    it('joins the messages into one line', () => {
        expect(
            apiErrorText(
                httpError(
                    400,
                    body('Validation failed', { messages: ['a', 'b'] }),
                ),
            ),
        ).toBe('a; b');
    });

    it('uses the fallback for an error that is not from axios', () => {
        expect(
            apiErrorText(new TypeError('x is undefined'), 'Could not load'),
        ).toBe('Could not load');
    });
});
