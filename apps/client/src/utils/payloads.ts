import type { DiscountType } from '@grocery-pos/contracts';

/**
 * Request bodies for the back-office write flows, built from the form
 * drafts (issue #33). The API's ValidationPipe refuses any property its DTO
 * does not declare (`forbidNonWhitelisted`), so each mapper copies exactly
 * the DTO's fields and nothing else. The drafts keep UI-only fields (the
 * row's display name and EAN, `isNewProduct`, `autoGenerateEAN`) that must
 * never be sent.
 *
 * The API's e2e specs post these exact shapes; keep them in step:
 * apps/api/src/product/product.payloads.e2e.spec.ts and
 * apps/api/src/inventory-man/inventory-payloads.e2e.spec.ts.
 *
 * Blank numeric fields are passed through as they are (validated by #17).
 */

/** A new product draft as the product dialogs hold it. Money in centavos. */
export interface ProductDraft {
    EAN: string;
    name: string;
    price?: number;
    autoGenerateEAN: boolean;
}

/**
 * The barcode to send: none when the server generates it, so a value typed
 * before ticking "Auto-generate" is never sent (the server validates any
 * EAN it gets, #14).
 */
function typedEAN(draft: Pick<ProductDraft, 'EAN' | 'autoGenerateEAN'>) {
    return draft.autoGenerateEAN ? {} : { EAN: draft.EAN };
}

/** `GET /products/ensureValid` query (`EnsureValidDto`). */
export interface EnsureValidQuery {
    EAN?: string;
    name: string;
    autoGenerateEAN: boolean;
}

export function toEnsureValidQuery(
    draft: Pick<ProductDraft, 'EAN' | 'name' | 'autoGenerateEAN'>,
): EnsureValidQuery {
    return {
        ...typedEAN(draft),
        name: draft.name,
        autoGenerateEAN: draft.autoGenerateEAN,
    };
}

/**
 * One new product (`NewProductFields`): `POST /products/bulk` and a
 * restock line's `newProduct`. No EAN: the server generates one.
 */
export interface NewProductBody {
    EAN?: string;
    name: string;
    /** Centavos. */
    price: number | undefined;
}

export function toNewProduct(draft: ProductDraft): NewProductBody {
    return { ...typedEAN(draft), name: draft.name, price: draft.price };
}

/** `POST /products/bulk` body (`NewProductsDto`). */
export function toNewProductsBody(drafts: ProductDraft[]): {
    newProducts: NewProductBody[];
} {
    return { newProducts: drafts.map(toNewProduct) };
}

/** A restock draft line. Money in centavos. */
export interface RestockDraft extends ProductDraft {
    isNewProduct: boolean;
    product?: string;
    quantity: number;
    unitCost: number;
}

/** One `restockDetails` line (`RestockFields`): exactly one of the two. */
export type RestockLineBody = { quantity: number; unitCost: number } & (
    { newProduct: NewProductBody } | { product: string | undefined }
);

/** `POST /restocks` body (`RestockDto`). */
export function toRestockBody(
    drafts: RestockDraft[],
    description: string,
): { restockDetails: RestockLineBody[]; description: string } {
    return {
        restockDetails: drafts.map((d) => ({
            ...(d.isNewProduct
                ? { newProduct: toNewProduct(d) }
                : { product: d.product }),
            quantity: d.quantity,
            unitCost: d.unitCost,
        })),
        description,
    };
}

/**
 * The draft line (0-based) of each new product in `toRestockBody`'s
 * output, in insert order: the API inserts only the new products, so its
 * duplicate-key and barcode errors count positions among those.
 */
export function newProductLines(
    drafts: Pick<RestockDraft, 'isNewProduct'>[],
): number[] {
    return drafts.flatMap((d, line) => (d.isNewProduct ? [line] : []));
}

/** An adjustment draft line; EAN and name are for display only. */
export interface AdjustmentDraft {
    product: string;
    change: number;
    reason: string;
}

/** One `adjustDetails` line (`AdjustFields`). */
export interface AdjustmentLineBody {
    product: string;
    change: number;
    reason: string;
}

/** `POST /adjustments` body (`AdjustDto`). */
export function toAdjustmentBody(
    drafts: AdjustmentDraft[],
    description: string,
): { adjustDetails: AdjustmentLineBody[]; description: string } {
    return {
        adjustDetails: drafts.map((d) => ({
            product: d.product,
            change: d.change,
            reason: d.reason,
        })),
        description,
    };
}

/** A register ticket line; EAN, name and unit price are for display only. */
export interface SaleLineDraft {
    product: string;
    quantity: number;
}

/** The ticket part of `POST /sales` (`SellDto`: `sellDetails`, `discount`). */
export interface SaleTicketBody {
    sellDetails: { product: string; quantity: number }[];
    discount?: { type: DiscountType; value: number; reason: string };
}

/**
 * The ticket part of `POST /sales` from the register's cart (#23). Only
 * `product` and `quantity` go per line: the server prices the sale. The
 * discount is sent as type, value (percent, or centavos for FIXED) and
 * trimmed reason, never an amount; `null` sends none.
 */
export function toSaleTicket(
    lines: SaleLineDraft[],
    discount: { type: DiscountType; value: number; reason: string } | null,
): SaleTicketBody {
    return {
        sellDetails: lines.map((l) => ({
            product: l.product,
            quantity: l.quantity,
        })),
        ...(discount && {
            discount: {
                type: discount.type,
                value: discount.value,
                reason: discount.reason.trim(),
            },
        }),
    };
}
