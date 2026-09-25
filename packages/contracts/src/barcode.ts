import { EAN_COUNTER } from './limits';

/**
 * Product barcodes (issue #14). A product may carry an EAN-13, a UPC-A
 * (12 digits) or an EAN-8, each with a valid GS1 check digit. The code is
 * stored exactly as scanned: a UPC-A is not zero-padded into an EAN-13.
 *
 * The store's own generated codes are 13-digit EAN-13s that start with
 * `EAN_COUNTER.PREFIX` (the API's EAN counter: prefix, then the counter,
 * then the check digit). A typed or scanned code in that range is refused,
 * so it can never take a value the counter will hand out later.
 *
 * Shared so the client's inline feedback and the API's DTO validation
 * apply the same rules.
 */
export const BARCODE_LENGTHS = {
    EAN_13: 13,
    UPC_A: 12,
    EAN_8: 8,
} as const;

/** The leading digits of every barcode the store generates itself. */
export const GENERATED_BARCODE_PREFIX = String(EAN_COUNTER.PREFIX);

export const BARCODE_MESSAGES = {
    FORMAT: 'Barcode must be an EAN-13 (13 digits), UPC-A (12 digits) or EAN-8 (8 digits), digits only',
    CHECK_DIGIT:
        'Barcode check digit is invalid: check the code and scan or type it again',
    RESERVED: `Barcodes starting with ${GENERATED_BARCODE_PREFIX} are reserved for codes the store generates; use auto-generate instead`,
} as const;

const VALID_LENGTHS: readonly number[] = Object.values(BARCODE_LENGTHS);

/**
 * The GS1 check digit for `body` (every digit but the check digit). Weights
 * run 3, 1, 3, ... from the rightmost digit, so one function serves EAN-13,
 * UPC-A and EAN-8. `body` must be digits only.
 */
export function gtinCheckDigit(body: string): number {
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
        const digit = Number(body[body.length - 1 - i]);
        sum += i % 2 === 0 ? digit * 3 : digit;
    }
    return (10 - (sum % 10)) % 10;
}

/** True if `code` is all digits and its last digit is the right check digit. */
export function hasValidCheckDigit(code: string): boolean {
    if (!/^\d{2,}$/.test(code)) return false;
    return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/** True if `code` falls in the range the store's EAN counter generates. */
export function isReservedBarcode(code: string): boolean {
    return (
        code.length === BARCODE_LENGTHS.EAN_13 &&
        code.startsWith(GENERATED_BARCODE_PREFIX)
    );
}

/**
 * Why a typed or scanned barcode is refused, or `null` if it is accepted.
 * Checks, in order: format (digits only, 8, 12 or 13 long), check digit,
 * then the reserved generated range. Codes the server generates are not
 * checked here: they are always in the reserved range.
 */
export function barcodeError(code: string): string | null {
    if (!/^\d+$/.test(code) || !VALID_LENGTHS.includes(code.length)) {
        return BARCODE_MESSAGES.FORMAT;
    }
    if (!hasValidCheckDigit(code)) return BARCODE_MESSAGES.CHECK_DIGIT;
    if (isReservedBarcode(code)) return BARCODE_MESSAGES.RESERVED;
    return null;
}
