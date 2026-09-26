import type { DiscountInput } from '../discount.js';
import type { Category, PaymentType } from '../enums.js';
import type { Role } from '../roles.js';
import type { Tender } from '../sales.js';
import type { BillCounts, CashierDrawerMovement } from '../shift.js';

/*
 * Request bodies (issue #90): each body the client sends, as JSON. The
 * API's DTO classes `implements` these, and the client's payload mappers
 * return them, so a field added on one side only fails `tsc`. The DTOs
 * hold the validation rules; these types hold only the fields. Ids are
 * strings and money integer centavos. An optional DTO field is optional
 * here.
 */

// --- Auth and users ---

/** `POST /auth/login`. */
export interface LoginRequest {
    username: string;
    password: string;
}

/** One new account in `POST /users`. */
export interface CreateUserRequest {
    name: string;
    password: string;
    roles: Role[];
}

/** `POST /users`. */
export interface CreateUsersRequest {
    users: CreateUserRequest[];
}

/**
 * The changes to one account in `PATCH /users`: at least one field. A
 * `password` here is an admin reset.
 */
export interface UserUpdate {
    name?: string;
    password?: string;
    roles?: Role[];
    isActive?: boolean;
}

/** One entry of `PATCH /users`. */
export interface UserUpdateRequest {
    user: string;
    update: UserUpdate;
}

/** `PATCH /users`. */
export interface UpdateUsersRequest {
    updates: UserUpdateRequest[];
}

/** `PATCH /users/me/password`: both passwords as typed, never trimmed. */
export interface ChangePasswordRequest {
    currentPassword: string;
    newPassword: string;
}

// --- Sales ---

/** One ticket line of `POST /sales`: the server prices it. */
export interface SaleLineRequest {
    product: string;
    quantity: number;
}

/** The ticket part of `POST /sales`: what is sold, not how it is paid. */
export interface SaleTicketRequest {
    sellDetails: SaleLineRequest[];
    discount?: DiscountInput;
}

/** The payment part of `POST /sales`. */
export interface PaymentRequest {
    paymentType: PaymentType;
    tenders: Tender[];
    /** GCash reference, digits only; sent for GCASH and SPLIT, never CASH. */
    referenceNumber?: string;
}

/** `POST /sales`. */
export interface SaleRequest extends SaleTicketRequest, PaymentRequest {
    /** One UUID per checkout attempt, reused on every retry of it. */
    idempotencyKey: string;
}

/** `POST /sales/:id/void` and `POST /sales/:id/refund`. */
export interface ReverseSaleRequest {
    reason: string;
    /** The open shift that pays the cash back when the sale's own is closed. */
    payoutShiftId?: string;
}

// --- Shifts ---

/** `POST /shifts`: the counted opening float. */
export interface OpenShiftRequest {
    counts: BillCounts;
}

/** `POST /shifts/current/close` and `POST /shifts/:id/close`. */
export interface CloseShiftRequest {
    counts: BillCounts;
}

/** `POST /shifts/current/drawer`: a cash in or cash drop, in centavos. */
export interface DrawerMovementRequest {
    type: CashierDrawerMovement;
    amount: number;
    reason: string;
}

// --- Catalog and stock ---

/**
 * One new product: a line of `POST /products/bulk` and a restock line's
 * `newProduct`. Without an `EAN` the server generates one.
 */
export interface NewProductRequest {
    EAN?: string;
    name: string;
    category?: Category;
    /** Centavos. */
    price: number;
}

/** `POST /products/bulk`. */
export interface NewProductsRequest {
    newProducts: NewProductRequest[];
}

/**
 * The fields of a restock line, as the API's DTO declares them: both
 * `newProduct` and `product` optional, with exactly one checked at
 * runtime. The client builds each line as a `RestockLineRequest`, which
 * says so in the type.
 */
export interface RestockLineFields {
    newProduct?: NewProductRequest;
    product?: string;
    quantity: number;
    /** Centavos; may be 0. */
    unitCost: number;
}

/** One `restockDetails` line: an existing `product` or a `newProduct`. */
export type RestockLineRequest = Omit<
    RestockLineFields,
    'newProduct' | 'product'
> &
    (
        | { newProduct: NewProductRequest; product?: never }
        | { product: string; newProduct?: never }
    );

/** `POST /restocks`. */
export interface RestockRequest {
    restockDetails: RestockLineFields[];
    description: string;
}

/** One `adjustDetails` line: a signed, non-zero stock change. */
export interface AdjustmentLineRequest {
    product: string;
    change: number;
    reason: string;
}

/** `POST /adjustments`. */
export interface AdjustmentRequest {
    adjustDetails: AdjustmentLineRequest[];
    description: string;
}
