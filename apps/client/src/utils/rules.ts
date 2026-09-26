import {
    barcodeError,
    NUMERIC_LIMITS,
    STRING_LIMITS,
} from '@grocery-pos/contracts';
import { formatCurrency, parsePesos } from './currency';

/*
 * Field rules for the back-office forms (issue #17). Each returns why a
 * value is refused, or '' when it is accepted, and mirrors the API DTO the
 * form posts to: the client must be neither stricter nor looser than the
 * server. Numeric fields bound with `v-model.number` hold '' while blank
 * (Vue's looseToNumber leaves unparsable text as it is), so these rules
 * take `unknown` and reject anything that is not a real value.
 */

export const REQUIRED = 'This field is required';

/** A required text field, trimmed as the API trims it, at most `max` long. */
export function textError(value: unknown, max: number): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return REQUIRED;
    if (text.length > max) return `At most ${max} characters`;
    return '';
}

/** True when a `v-model.number` field was left blank. */
function isBlank(value: unknown): boolean {
    return value == null || (typeof value === 'string' && value.trim() === '');
}

/**
 * A whole-number field (`@IsInt()` on the API), e.g. a restock quantity
 * (`min: 1`) or an adjustment change (`nonZero`, may be negative).
 */
export function integerError(
    value: unknown,
    options: { min?: number; nonZero?: boolean } = {},
): string {
    if (isBlank(value)) return REQUIRED;
    if (typeof value !== 'number' || !Number.isInteger(value))
        return 'Enter a whole number';
    if (options.min !== undefined && value < options.min)
        return `Must be at least ${options.min}`;
    if (options.nonZero && value === 0) return 'Must not be 0';
    return '';
}

/**
 * A money field typed in pesos, as the text the user typed. The API takes
 * integer centavos between `min` (default `NUMERIC_LIMITS.PRICE_MIN`, one
 * centavo: prices and costs are never free) and `NUMERIC_LIMITS.AMOUNT_MAX`.
 */
export function moneyError(
    value: unknown,
    min: number = NUMERIC_LIMITS.PRICE_MIN,
): string {
    if (isBlank(value)) return REQUIRED;
    const centavos =
        typeof value === 'string' || typeof value === 'number'
            ? parsePesos(value)
            : null;
    if (centavos === null) return 'Enter an amount in pesos, up to 2 decimals';
    if (centavos < min) return `Enter at least ${formatCurrency(min)}`;
    if (centavos > NUMERIC_LIMITS.AMOUNT_MAX)
        return `At most ${formatCurrency(NUMERIC_LIMITS.AMOUNT_MAX)}`;
    return '';
}

/**
 * The picked product of an existing-product line: its id, never the text
 * typed into the search box (a typed-but-unpicked line would 400).
 */
export function productPickError(productId: unknown): string {
    return typeof productId === 'string' && productId
        ? ''
        : 'Pick a product from the matches';
}

/** The password policy, as shown next to password fields. */
export const PASSWORD_HINT = `At least ${STRING_LIMITS.PASSWORD_MIN} characters`;

/**
 * Why `value` is not an acceptable new password, or '' when it is (or when
 * it is empty and `optional`, e.g. "leave blank to keep the current one").
 * Mirrors the API's check on create, admin reset and self-service change;
 * login does not apply it.
 */
export function passwordError(value: string, optional = false): string {
    if (!value) return optional ? '' : 'Password is required';
    if (value.length < STRING_LIMITS.PASSWORD_MIN) return PASSWORD_HINT;
    if (value.length > STRING_LIMITS.PASSWORD)
        return `At most ${STRING_LIMITS.PASSWORD} characters`;
    return '';
}

/**
 * The current password of a self-service change (`ChangePasswordDto`,
 * #88): required and at most `STRING_LIMITS.PASSWORD`, never trimmed, and
 * no length minimum (an old password may predate the policy).
 */
export function currentPasswordError(value: string): string {
    if (!value) return 'Current password is required';
    if (value.length > STRING_LIMITS.PASSWORD)
        return `At most ${STRING_LIMITS.PASSWORD} characters`;
    return '';
}

export const PASSWORDS_DIFFER = 'The passwords do not match';

/**
 * The "confirm new password" field (#88): client-side only, it is never
 * sent. It must repeat the new password exactly.
 */
export function confirmPasswordError(
    newPassword: string,
    confirm: string,
): string {
    if (!confirm) return 'Confirm the new password';
    return confirm === newPassword ? '' : PASSWORDS_DIFFER;
}

/**
 * Why a typed or scanned product barcode is refused, or '' when it is
 * accepted (or auto-generated, so not typed at all). The same rules as the
 * API's create and import validation (`barcodeError` in contracts, #14):
 * EAN-13, UPC-A or EAN-8 with a valid check digit, outside the store's
 * generated range.
 */
export function barcodeFieldError(
    value: string,
    autoGenerate: boolean,
): string {
    if (autoGenerate) return '';
    const code = value.trim();
    if (!code) return REQUIRED;
    return barcodeError(code) ?? '';
}

export const DATE_RANGE_REVERSED = 'The end date is before the start date';

/**
 * Why a `From`/`To` date filter (`YYYY-MM-DD`, as a date input holds it)
 * would be refused, or '' when it is fine (issue #20). Mirrors the API's
 * `@IsNotBefore('dateFrom')` on `dateTo`; either end may be blank.
 */
export function dateRangeError(from: string, to: string): string {
    return from && to && to < from ? DATE_RANGE_REVERSED : '';
}

/** Keeps only the fields whose rule refused them: `{}` means valid. */
export function fieldErrors(
    checks: Record<string, string>,
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(checks).filter(([, message]) => message),
    );
}
