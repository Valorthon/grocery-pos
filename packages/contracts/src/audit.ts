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
}
export const AUDIT_LIMITS = { USER_AGENT: 512, IP: 64 } as const;
export type AuditValue = string | number | boolean | null | string[];
export interface AuditLogView {
    _id: string;
    actor: { _id: string; name: string } | null;
    action: AuditAction;
    target: { model: string; id: string | null };
    before: Record<string, AuditValue>;
    after: Record<string, AuditValue>;
    approvedBy: string | null;
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
    ip: 'required',
    userAgent: 'required',
    createdAt: 'required',
};
