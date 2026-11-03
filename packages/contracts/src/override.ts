/** The persisted monetary action a manager approves (#34). */
export enum OverrideAction {
    DISCOUNT = 'DISCOUNT',
    VOID = 'VOID',
    REFUND = 'REFUND',
}

/** Approvals expire independently of MongoDB's asynchronous TTL cleanup. */
export const OVERRIDE_APPROVAL_TTL_S = 60;

export const OVERRIDE_PIN_LENGTH = 6;

export interface ManagerOverrideResponse {
    token: string;
    expiresAt: string;
    approver: { _id: string; name: string };
}

export const MANAGER_OVERRIDE_SHAPE: import('./wire-shape.js').WireShape<ManagerOverrideResponse> =
    {
        token: 'required',
        expiresAt: 'required',
        approver: 'required',
    };
