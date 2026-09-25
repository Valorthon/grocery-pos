import { barcodeError, STRING_LIMITS } from '@grocery-pos/contracts';

export const rules = {
    required: (v: unknown) => !!v || 'This field is required',
    minZero: (v: number) => v >= 0 || 'Cannot be negative',
    minOne: (v: number) => v >= 1 || 'Must be at least 1',
};

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
    if (!code) return 'This field is required';
    return barcodeError(code) ?? '';
}
