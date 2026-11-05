import { AuditAction, type AuditValue } from '@grocery-pos/contracts';

const FIELDS: Record<AuditAction, readonly string[]> = {
    [AuditAction.SETTINGS_UPDATED]: [
        'storeName',
        'branchName',
        'address',
        'contactNumber',
        'tin',
        'receiptFooter',
        'timezone',
        'currency',
        'defaultReorderLevel',
        'version',
    ],
    [AuditAction.USER_CREATED]: ['name', 'roles', 'isActive'],
    [AuditAction.USER_UPDATED]: ['name', 'roles', 'isActive'],
    [AuditAction.USER_ROLE_CHANGED]: ['roles'],
    [AuditAction.USER_DEACTIVATED]: ['isActive'],
    [AuditAction.USER_REACTIVATED]: ['isActive'],
    [AuditAction.USER_PASSWORD_RESET]: ['passwordChanged'],
    [AuditAction.USER_PASSWORD_CHANGED]: ['passwordChanged'],
    [AuditAction.USER_PIN_CHANGED]: ['pinConfigured'],
    [AuditAction.PRODUCT_PRICE_CHANGED]: ['price', 'unit'],
    [AuditAction.SALE_DISCOUNTED]: [
        'subtotal',
        'amount',
        'total',
        'type',
        'value',
        'reason',
    ],
    [AuditAction.SALE_VOIDED]: ['status', 'amount', 'reason', 'payoutShift'],
    [AuditAction.SALE_REFUNDED]: ['status', 'amount', 'reason', 'payoutShift'],
    [AuditAction.SHIFT_OPENED]: ['status', 'float'],
    [AuditAction.SHIFT_CLOSED]: ['status', 'counted', 'expected', 'variance'],
    [AuditAction.SHIFT_FORCE_CLOSED]: [
        'status',
        'counted',
        'expected',
        'variance',
    ],
    [AuditAction.SHIFT_CASH_IN]: ['amount', 'reason'],
    [AuditAction.SHIFT_CASH_DROPPED]: ['amount', 'reason'],
    [AuditAction.AUTH_LOGIN]: ['name'],
    [AuditAction.AUTH_LOGIN_FAILED]: ['name'],
};
/** Positive allowlist: never serialize a document, request, credential or nested object. */
export function auditFields(
    action: AuditAction,
    input: Record<string, unknown>,
): Record<string, AuditValue> {
    const result: Record<string, AuditValue> = {};
    for (const key of FIELDS[action]) {
        const value = input[key];
        if (value === null || typeof value === 'boolean') result[key] = value;
        else if (typeof value === 'string') result[key] = value.slice(0, 1024);
        else if (typeof value === 'number' && Number.isSafeInteger(value))
            result[key] = value;
        else if (
            Array.isArray(value) &&
            value.length <= 100 &&
            value.every((part: unknown) => typeof part === 'string')
        ) {
            result[key] = value.map((part: string) => part.slice(0, 128));
        }
    }
    return result;
}
