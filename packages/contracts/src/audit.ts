import type { WireShape } from './wire-shape.js';

/** Business events only: credentials, session tokens and raw requests are never audit data. */
export enum AuditAction {
    SETTINGS_UPDATED = 'SETTINGS.UPDATED',
    USER_CREATED = 'USER.CREATED',
    USER_UPDATED = 'USER.UPDATED',
    USER_ROLE_CHANGED = 'USER.ROLE_CHANGED',
    USER_DEACTIVATED = 'USER.DEACTIVATED',
    USER_REACTIVATED = 'USER.REACTIVATED',
    USER_PASSWORD_RESET = 'USER.PASSWORD_RESET',
    USER_PASSWORD_CHANGED = 'USER.PASSWORD_CHANGED',
    USER_PIN_CHANGED = 'USER.PIN_CHANGED',
    PRODUCT_PRICE_CHANGED = 'PRODUCT.PRICE_CHANGED',
    SALE_DISCOUNTED = 'SALE.DISCOUNTED',
    SALE_VOIDED = 'SALE.VOIDED',
    SALE_REFUNDED = 'SALE.REFUNDED',
    SHIFT_OPENED = 'SHIFT.OPENED',
    SHIFT_CLOSED = 'SHIFT.CLOSED',
    SHIFT_FORCE_CLOSED = 'SHIFT.FORCE_CLOSED',
    SHIFT_CASH_IN = 'SHIFT.CASH_IN',
    SHIFT_CASH_DROPPED = 'SHIFT.CASH_DROPPED',
    AUTH_LOGIN = 'AUTH.LOGIN',
    AUTH_LOGIN_FAILED = 'AUTH.LOGIN_FAILED',
    PURCHASE_ORDER_CREATED = 'PURCHASE_ORDER.CREATED',
    PURCHASE_ORDER_UPDATED = 'PURCHASE_ORDER.UPDATED',
    PURCHASE_ORDER_SENT = 'PURCHASE_ORDER.SENT',
    PURCHASE_ORDER_CANCELLED = 'PURCHASE_ORDER.CANCELLED',
    PURCHASE_ORDER_RECEIVED = 'PURCHASE_ORDER.RECEIVED',
}
/** Audit Log screen labels, one per action. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
    [AuditAction.SETTINGS_UPDATED]: 'Store settings updated',
    [AuditAction.USER_CREATED]: 'User created',
    [AuditAction.USER_UPDATED]: 'User updated',
    [AuditAction.USER_ROLE_CHANGED]: 'User roles changed',
    [AuditAction.USER_DEACTIVATED]: 'User deactivated',
    [AuditAction.USER_REACTIVATED]: 'User reactivated',
    [AuditAction.USER_PASSWORD_RESET]: 'Password reset',
    [AuditAction.USER_PASSWORD_CHANGED]: 'Password changed',
    [AuditAction.USER_PIN_CHANGED]: 'Manager PIN changed',
    [AuditAction.PRODUCT_PRICE_CHANGED]: 'Product price changed',
    [AuditAction.SALE_DISCOUNTED]: 'Sale discounted',
    [AuditAction.SALE_VOIDED]: 'Sale voided',
    [AuditAction.SALE_REFUNDED]: 'Sale refunded',
    [AuditAction.SHIFT_OPENED]: 'Shift opened',
    [AuditAction.SHIFT_CLOSED]: 'Shift closed',
    [AuditAction.SHIFT_FORCE_CLOSED]: 'Shift force-closed',
    [AuditAction.SHIFT_CASH_IN]: 'Cash in',
    [AuditAction.SHIFT_CASH_DROPPED]: 'Cash drop',
    [AuditAction.AUTH_LOGIN]: 'Logged in',
    [AuditAction.AUTH_LOGIN_FAILED]: 'Login failed',
    [AuditAction.PURCHASE_ORDER_CREATED]: 'Purchase order created',
    [AuditAction.PURCHASE_ORDER_UPDATED]: 'Purchase order draft edited',
    [AuditAction.PURCHASE_ORDER_SENT]: 'Purchase order sent',
    [AuditAction.PURCHASE_ORDER_CANCELLED]: 'Purchase order cancelled',
    [AuditAction.PURCHASE_ORDER_RECEIVED]: 'Purchase order received',
};
export const AUDIT_LIMITS = { USER_AGENT: 512, IP: 64 } as const;
export type AuditValue = string | number | boolean | null | string[];
export interface AuditLogView {
    _id: string;
    actor: { _id: string; name: string } | null;
    action: AuditAction;
    /**
     * `label` is the target's current name, looked up on read (#306):
     * absent when there is none or the reference is gone.
     */
    target: { model: string; id: string | null; label?: string };
    before: Record<string, AuditValue>;
    after: Record<string, AuditValue>;
    approvedBy: string | null;
    /** The approver's current name, looked up on read (#306). */
    approvedByName?: string;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
}
export const AUDIT_LOG_SHAPE: WireShape<AuditLogView> = {
    _id: 'required',
    actor: 'required',
    action: 'required',
    target: 'required',
    before: 'required',
    after: 'required',
    approvedBy: 'required',
    approvedByName: 'optional',
    ip: 'required',
    userAgent: 'required',
    createdAt: 'required',
};
