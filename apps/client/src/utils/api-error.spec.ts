import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { apiErrorMessages, NETWORK_ERROR_MESSAGE } from './api-error';

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
});
