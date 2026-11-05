import type { WireShape } from './wire-shape.js';

export const SUPPLIER_LIMITS = {
    NAME: 120,
    CONTACT: 120,
    PHONE: 40,
    EMAIL: 254,
    ADDRESS: 500,
    TIN: 40,
    INVOICE: 100,
} as const;

export interface SupplierFields {
    name: string;
    contactPerson?: string;
    phone?: string;
    email?: string;
    address?: string;
    TIN?: string;
}
export type CreateSupplierRequest = SupplierFields;
export type UpdateSupplierRequest = Partial<SupplierFields> & {
    isActive?: boolean;
};
export interface SupplierView extends SupplierFields {
    _id: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
export const SUPPLIER_SHAPE: WireShape<SupplierView> = {
    _id: 'required',
    name: 'required',
    contactPerson: 'optional',
    phone: 'optional',
    email: 'optional',
    address: 'optional',
    TIN: 'optional',
    isActive: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};

export interface ProductCostView {
    product: string;
    lastCost?: number;
    costUpdatedAt?: string;
    /** Latest-receipt estimate, admin-only. Not FIFO or weighted average. */
    marginBasisPoints?: number;
}
export const PRODUCT_COST_SHAPE: WireShape<ProductCostView> = {
    product: 'required',
    lastCost: 'optional',
    costUpdatedAt: 'optional',
    marginBasisPoints: 'optional',
};
