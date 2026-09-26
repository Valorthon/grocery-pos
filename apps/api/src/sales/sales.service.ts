import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { SaleDoc, SaleRowDoc, Sales } from './sales.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { SaleLineDoc, SalesDetails } from './sales-details.schema';
import {
    DiscountType,
    GetAllDto,
    GetDetailsDto,
    ReceiptDiscount,
    ReceiptDto,
    ReceiptFields,
    ReverseSaleInput,
    SaleStatus,
    SellDto,
} from './types';
import {
    discountAmount,
    type Paginated,
    REVERSAL_STATUS,
    saleNetCash,
} from '@grocery-pos/contracts';
import type { NameRef } from '../common/wire';
import {
    DISCOUNT_LIMITS,
    NUMERIC_LIMITS,
    REVERSED_SALE_STATUSES,
} from '../constants';
import { ProductService } from '../product/product.service';
import { runInTransaction } from '../common/utils/db';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { AuthUser, Role } from '../auth/types';
import {
    ConflictError,
    ErrorCode,
    NotFoundError,
    ValidationError,
} from '../common/errors';
import { Settlement, settleTenders } from './tender';
import { isDuplicateKey, saleRequestHash } from './idempotency';
import { ShiftService } from '../shift/shift.service';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { dateRangeFilter } from '../common/utils/timezone';

/**
 * Sale fields a non-admin never reads: which shift paid a reversal back and
 * how much. The cashier is blind to drawer figures until their own Z-read
 * (issue #2), and a payout may have come out of another cashier's drawer.
 */
export const CASHIER_HIDDEN_SALE_FIELDS = {
    'reversal.payoutShift': 0,
    'reversal.payoutAmount': 0,
} as const;

/** A sales filter, or null when the caller may read no sale at all. */
export type SaleScope = { cashier?: Types.ObjectId; shift?: Types.ObjectId };

/**
 * The sales a user may read (issue #13, narrowed by #2): an ADMIN reads every
 * sale; anyone else, including a manager who also sells, reads only the
 * sales they rang up in their current open shift (`openShift`). With no open
 * shift they read none (null).
 */
export function saleScope(
    user: AuthUser,
    openShift: Types.ObjectId | null,
): SaleScope | null {
    if (user.roles.includes(Role.Admin)) return {};
    if (!openShift) return null;
    return { cashier: new Types.ObjectId(user.userId), shift: openShift };
}

/**
 * The `GET /sales` filter: the caller's `scope` narrowed by the query's
 * `cashier` and `dateFrom`/`dateTo` (inclusive store-timezone days, the same
 * convention as restocks, adjustments and the dashboard).
 *
 * A filter can only narrow: a scope that already names a cashier (a
 * non-admin's own) combined with a different `cashier` matches nothing, so
 * this returns null and the caller lists no sales.
 */
export function salesListFilter(
    scope: SaleScope,
    dto: Pick<GetAllDto, 'cashier' | 'dateFrom' | 'dateTo'>,
    timeZone: string,
): Record<string, unknown> | null {
    const filter: Record<string, unknown> = { ...scope };

    if (dto.cashier) {
        const cashier = new Types.ObjectId(dto.cashier);
        if (scope.cashier && !scope.cashier.equals(cashier)) return null;
        filter.cashier = cashier;
    }

    const createdAt = dateRangeFilter(dto.dateFrom, dto.dateTo, timeZone);
    if (createdAt) filter.createdAt = createdAt;

    return filter;
}

@Injectable()
export class SalesService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(Sales.name) private model: Model<Sales>,
        @InjectModel(SalesDetails.name)
        private modelDetails: Model<SalesDetails>,
        private productService: ProductService,
        private inventoryService: InventoryService,
        private shiftService: ShiftService,
        private config: TypedConfigService,
    ) {}

    /** `saleScope` for the caller, looking up their open shift if needed. */
    private async scopeFor(user: AuthUser): Promise<SaleScope | null> {
        if (user.roles.includes(Role.Admin)) return {};
        return saleScope(
            user,
            await this.shiftService.openShiftIdOf(user.userId),
        );
    }

    /**
     * A page of sales, newest first. An ADMIN sees every cashier's sales;
     * anyone else only the sales they rang up in their current open shift
     * (`saleScope`), and nothing without one. The `cashier` and date
     * filters narrow that scope (`salesListFilter`) and never widen it.
     */
    async getAll(
        user: AuthUser,
        dto: GetAllDto,
    ): Promise<Paginated<SaleRowDoc>> {
        const { page, limit } = dto;

        const skip = (page - 1) * limit;
        const scope = await this.scopeFor(user);
        if (!scope) return { data: [], totalItems: 0 };

        const filter = salesListFilter(
            scope,
            dto,
            this.config.get('STORE_TIMEZONE'),
        );
        if (!filter) return { data: [], totalItems: 0 };

        const projection = user.roles.includes(Role.Admin)
            ? undefined
            : CASHIER_HIDDEN_SALE_FIELDS;

        const [data, totalItems] = await Promise.all([
            this.model
                .find(filter, projection)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate<{ cashier: NameRef | null }>({
                    path: 'cashier',
                    select: 'name',
                })
                .lean<SaleRowDoc[]>(),

            // Exact, never estimatedDocumentCount: the total is shown to
            // the user and must match the pages (issue #16).
            this.model.countDocuments(filter),
        ]);

        return {
            data,
            totalItems,
        };
    }

    /**
     * The lines of one sale. A sale outside the caller's `saleScope`
     * (another cashier's, or their own from another shift, for a
     * non-admin) is a 404, exactly like a sale that does not exist, so its
     * existence is not leaked.
     */
    async getDetails(
        user: AuthUser,
        dto: GetDetailsDto,
    ): Promise<SaleLineDoc[]> {
        const { sales } = dto;

        const scope = await this.scopeFor(user);
        const visible =
            scope && (await this.model.exists({ _id: sales, ...scope }));
        if (!visible) {
            throw new NotFoundError(ErrorCode.NOT_FOUND, 'Sale not found', {
                sale: sales,
            });
        }

        return await this.modelDetails
            .find({ sales })
            .populate<{ product: NameRef | null }>({
                path: 'product',
                select: 'name',
            })
            .lean<SaleLineDoc[]>();
    }

    /**
     * Records a sale into the cashier's open shift, idempotently on
     * `dto.idempotencyKey`. With no open shift it is a 409 SHIFT_NOT_OPEN
     * and nothing is written (`ShiftService.chargeSale`).
     *
     * - A key that already recorded a sale returns that sale's receipt, built
     *   from what was stored, and changes nothing: no second sale, no second
     *   stock decrement. This is checked first, so replaying a GCash sale
     *   does not trip over its own reference number.
     * - A key that recorded a different request (see `saleRequestHash`) is
     *   a 409 SALE_IDEMPOTENCY_MISMATCH.
     * - Of concurrent requests with one key, the unique index lets exactly
     *   one sale commit. A loser (duplicate key, write conflict, or a stock
     *   or reference failure caused by the winner) looks the key up again and
     *   returns the winner's receipt; if the winner is not visible yet it
     *   gets a 409 SALE_IN_PROGRESS and should retry with the same key.
     * - A replay needs no open shift: it records nothing, so a retry that
     *   arrives after the shift closed still gets its receipt.
     */
    async sell(
        user: AuthUser,
        dto: SellDto,
        session?: ClientSession,
    ): Promise<ReceiptDto> {
        const requestHash = saleRequestHash(user.userId, dto);

        const replay = await this.findReplay(
            user,
            dto.idempotencyKey,
            requestHash,
            session,
        );
        if (replay) return replay;

        try {
            return await this.recordSale(user, dto, requestHash, session);
        } catch (err) {
            // Inside a caller's transaction the committed state cannot be
            // read past it; the caller owns the retry.
            if (session) throw err;

            const committed = await this.findReplay(
                user,
                dto.idempotencyKey,
                requestHash,
            );
            if (committed) return committed;
            throw err;
        }
    }

    /**
     * The receipt of the sale already recorded under `idempotencyKey`, or
     * null if there is none. The request hash covers the cashier, so a
     * matching sale is always the requesting user's own.
     *
     * A key that recorded a different request is a 409 SALE_003:
     * - From the same cashier (the usual case: the response was lost and the
     *   cashier re-tendered differently), the details carry the stored
     *   sale's receipt, so the client can show it and credit the drawer from
     *   its original tenders instead of dead-ending or ringing it again.
     * - From another cashier, the details are empty: a key is a random UUID
     *   the client made, so this is misuse, and another cashier's receipt is
     *   not handed out.
     */
    private async findReplay(
        user: AuthUser,
        idempotencyKey: string,
        requestHash: string,
        session?: ClientSession,
    ): Promise<ReceiptDto | null> {
        const sale = await this.model
            .findOne({ idempotencyKey })
            .session(session ?? null)
            .lean();

        if (!sale) return null;

        if (sale.requestHash !== requestHash) {
            // Unpopulated, so the cashier is the stored ObjectId.
            const ownSale =
                (sale.cashier as Types.ObjectId).toString() === user.userId;
            throw new ConflictError(
                ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
                'This checkout was already recorded with a different payment',
                ownSale
                    ? {
                          sale: String(sale._id),
                          receipt: await this.receiptOf(sale, user, session),
                      }
                    : null,
            );
        }

        return this.receiptOf(sale, user, session);
    }

    /** Rebuilds a stored sale's receipt, the same shape `POST /sales` returns. */
    private async receiptOf(
        sale: Sales & { _id: unknown },
        user: AuthUser,
        session?: ClientSession,
    ): Promise<ReceiptDto> {
        const lines = await this.modelDetails
            .find({ sales: sale._id })
            .populate<{ product: { name?: string } | null }>({
                path: 'product',
                select: 'name',
            })
            .sort({ _id: 1 })
            .session(session ?? null)
            .lean();

        const items = lines.map(({ product, quantity, unitPrice }) => ({
            productName: product?.name ?? '',
            quantity,
            amount: unitPrice * quantity,
        }));

        const discount: ReceiptDiscount | null = sale.discount
            ? {
                  type: sale.discount.type,
                  value: sale.discount.value,
                  reason: sale.discount.reason,
                  amount: sale.discount.amount,
              }
            : null;

        return this.makeReceipt({
            saleId: String(sale._id),
            createdAt: sale.createdAt,
            status: sale.status ?? SaleStatus.COMPLETED,
            paymentType: sale.paymentType,
            referenceNumber: sale.referenceNumber ?? null,
            settlement: {
                tenders: (sale.tenders ?? []).map(({ type, amount }) => ({
                    type,
                    amount,
                })),
                amountTendered: sale.amountTendered ?? sale.amount,
                changeGiven: sale.changeGiven ?? 0,
            },
            itemsInfo: items,
            cashierName: user.username,
            subtotal: items.reduce((sum, item) => sum + item.amount, 0),
            discount,
            totalAmount: sale.amount,
        });
    }

    private async recordSale(
        user: AuthUser,
        dto: SellDto,
        requestHash: string,
        session?: ClientSession,
    ): Promise<ReceiptDto> {
        const { paymentType, referenceNumber, idempotencyKey } = dto;

        const {
            fullSellDetails,
            subtotal,
            discount,
            totalAmount,
            settlement,
            saleId,
            createdAt,
        } = await runInTransaction(
            async (session) => {
                // First, so a cashier with no open shift is refused before
                // anything else is read or written.
                const shift = await this.shiftService.chargeSale(
                    user.userId,
                    session,
                );

                const { subtotal, fullSellDetails } = await this.prepareSell(
                    dto,
                    session,
                );
                const { discount, totalAmount } = this.applyDiscount(
                    subtotal,
                    dto,
                );

                const settlement = settleTenders(
                    paymentType,
                    dto.tenders,
                    totalAmount,
                );

                const [created] = await this.createSale(
                    {
                        amount: totalAmount,
                        cashier: user.userId,
                        shift,
                        paymentType,
                        referenceNumber,
                        tenders: settlement.tenders,
                        amountTendered: settlement.amountTendered,
                        changeGiven: settlement.changeGiven,
                        status: SaleStatus.COMPLETED,
                        idempotencyKey,
                        requestHash,
                        // Until a manager override exists, any
                        // authenticated seller may discount, so the
                        // cashier is the approver.
                        ...(discount && {
                            discount: {
                                ...discount,
                                approvedBy: user.userId,
                            },
                        }),
                    },
                    session,
                );

                const inserts = fullSellDetails.map(
                    ({ product, quantity, unitPrice }) => ({
                        insertOne: {
                            document: {
                                product,
                                quantity,
                                unitPrice,
                                sales: created._id,
                            },
                        },
                    }),
                );

                await this.modelDetails.bulkWrite(inserts, { session });
                await this.inventoryService.sell(user.userId, dto, session);

                return {
                    fullSellDetails,
                    subtotal,
                    discount,
                    totalAmount,
                    settlement,
                    saleId: String(created._id),
                    createdAt: created.createdAt,
                };
            },
            this.connection,
            session,
        );

        return this.makeReceipt({
            saleId,
            createdAt,
            status: SaleStatus.COMPLETED,
            paymentType,
            referenceNumber: referenceNumber ?? null,
            settlement,
            itemsInfo: fullSellDetails,
            cashierName: user.username,
            subtotal,
            discount,
            totalAmount,
        });
    }

    /**
     * Inserts the sale, turning a unique-index clash into a 409. It has to
     * be caught here: inside the transaction the raw Mongo error would
     * otherwise surface as an opaque 500. `keyPattern` tells the two apart.
     *
     * A clash on the idempotency key means a concurrent request with the
     * same key committed first; `sell` then returns that sale instead.
     */
    private async createSale(
        doc: Record<string, unknown>,
        session: ClientSession,
    ) {
        try {
            return await this.model.create([doc], { session });
        } catch (err) {
            if (isDuplicateKey(err, 'idempotencyKey')) {
                throw new ConflictError(
                    ErrorCode.SALE_IN_PROGRESS,
                    'This sale is already being recorded. Retry in a moment.',
                    { idempotencyKey: doc.idempotencyKey },
                );
            }
            if (isDuplicateKey(err, 'referenceNumber')) {
                throw new ConflictError(
                    ErrorCode.SALE_DUPLICATE_REFERENCE,
                    'This GCash reference number was already used for another sale',
                    { referenceNumber: doc.referenceNumber },
                );
            }
            throw err;
        }
    }

    /**
     * Voids or refunds a whole sale: marks it, records who reversed it and
     * why, pays its net cash back out of a drawer, and puts every sold unit
     * back into inventory, all in one transaction. Void and refund differ
     * only in meaning (a mis-ring vs a customer return). Partial / per-line
     * refunds are not supported.
     *
     * The cash (cash tender less change) is paid out of the sale's own
     * shift while it is open, otherwise out of the open shift the ADMIN
     * names in `payoutShiftId` (see `ShiftService.payOutReversal`). A
     * refusal there rolls the whole reversal back: no status change, no
     * stock returned.
     */
    async reverse(
        user: AuthUser,
        saleId: string,
        { type, reason, payoutShiftId }: ReverseSaleInput,
        session?: ClientSession,
    ) {
        return runInTransaction(
            async (session) => {
                // The status filter makes the reversal a single atomic claim:
                // of two concurrent voids, only one can match.
                const sale = await this.model
                    .findOneAndUpdate(
                        {
                            _id: saleId,
                            status: { $nin: [...REVERSED_SALE_STATUSES] },
                        },
                        {
                            $set: {
                                status: REVERSAL_STATUS[type],
                                reversal: {
                                    type,
                                    reason,
                                    approvedBy: new Types.ObjectId(user.userId),
                                    at: new Date(),
                                },
                            },
                        },
                        { session, new: true, runValidators: true },
                    )
                    .lean<SaleDoc>();

                if (!sale) {
                    const existing = await this.model
                        .findById(saleId, { status: 1 })
                        .session(session)
                        .lean();

                    if (!existing) {
                        throw new NotFoundError(
                            ErrorCode.NOT_FOUND,
                            'Sale not found',
                            { sale: saleId },
                        );
                    }

                    throw new ConflictError(
                        ErrorCode.SALE_NOT_REVERSIBLE,
                        'Only a completed sale can be voided or refunded',
                        { sale: saleId, status: existing.status },
                    );
                }

                const payoutAmount = saleNetCash(sale);
                const payoutShift = await this.shiftService.payOutReversal(
                    {
                        saleId: String(sale._id),
                        saleShift: sale.shift ?? null,
                        amount: payoutAmount,
                        payoutShiftId,
                        type,
                        reason,
                        admin: user,
                    },
                    session,
                );

                if (payoutShift) {
                    await this.model.updateOne(
                        { _id: sale._id },
                        {
                            $set: {
                                'reversal.payoutShift': payoutShift,
                                'reversal.payoutAmount': payoutAmount,
                            },
                        },
                        { session },
                    );
                }

                const lines = await this.modelDetails
                    .find({ sales: saleId }, { product: 1, quantity: 1 })
                    .session(session)
                    .lean();

                await this.inventoryService.returnStock(
                    user.userId,
                    lines.map(({ product, quantity }) => ({
                        product: product as Types.ObjectId,
                        quantity,
                    })),
                    session,
                );

                return {
                    ...sale,
                    reversal: {
                        ...sale.reversal!,
                        ...(payoutShift && { payoutShift, payoutAmount }),
                    },
                };
            },
            this.connection,
            session,
        );
    }

    /**
     * Applies the requested whole-sale discount to the server-priced
     * subtotal. The client never sends an amount: it sends the type, value
     * and reason, and the server derives the centavos taken off.
     */
    private applyDiscount(
        subtotal: number,
        dto: SellDto,
    ): { discount: ReceiptDiscount | null; totalAmount: number } {
        const requested = dto.discount;

        if (!requested) {
            return { discount: null, totalAmount: subtotal };
        }

        if (
            requested.type === DiscountType.FIXED &&
            requested.value > subtotal
        ) {
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Discount exceeds the sale subtotal',
                { subtotal, discount: requested.value },
            );
        }

        const amount = discountAmount(subtotal, requested);
        const totalAmount = subtotal - amount;

        if (amount < DISCOUNT_LIMITS.AMOUNT_MIN) {
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Discount rounds to nothing',
                { subtotal, discount: amount },
            );
        }

        // Also catches a malformed discount that slipped past validation and
        // produced NaN, so it is a 400 here rather than a schema 500.
        if (
            !Number.isInteger(totalAmount) ||
            totalAmount < NUMERIC_LIMITS.AMOUNT_MIN
        ) {
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Discount leaves nothing to charge',
                { subtotal, discount: amount },
            );
        }

        return {
            discount: {
                type: requested.type,
                value: requested.value,
                reason: requested.reason,
                amount,
            },
            totalAmount,
        };
    }

    private makeReceipt({
        saleId,
        createdAt,
        status,
        paymentType,
        referenceNumber,
        settlement,
        itemsInfo,
        cashierName,
        subtotal,
        discount,
        totalAmount,
    }: {
        saleId: string;
        createdAt: Date;
        status: SaleStatus;
        paymentType: ReceiptDto['paymentType'];
        referenceNumber: string | null;
        settlement: Settlement;
        itemsInfo: ReceiptFields[];
        cashierName: string;
        subtotal: number;
        discount: ReceiptDiscount | null;
        totalAmount: number;
    }): ReceiptDto {
        const items: ReceiptFields[] = itemsInfo.map(
            ({ productName, quantity, amount }) => ({
                productName,
                quantity,
                amount,
            }),
        );

        return {
            _id: saleId,
            createdAt,
            status,
            paymentType,
            referenceNumber,
            tenders: settlement.tenders,
            amountTendered: settlement.amountTendered,
            changeGiven: settlement.changeGiven,
            cashierName,
            items,
            subtotal,
            discount,
            totalAmount,
        };
    }

    private async prepareSell(dto: SellDto, session?: ClientSession) {
        const { sellDetails } = dto;

        const productsMap = await this.productService.getMany(
            sellDetails.map((detail) => detail.product),
            session,
        );
        let subtotal = 0;

        const unknownProducts: string[] = [];

        const fullSellDetails = [];

        for (const { product, quantity } of sellDetails) {
            const productDetails = productsMap.get(product.toString());

            if (!productDetails) {
                unknownProducts.push(product.toString());
                continue;
            }

            // Integer centavos throughout, so the subtotal is exact.
            const unitPrice = productDetails.price;
            const productName = productDetails.name;

            const quantityAmount = unitPrice * quantity;
            subtotal += quantityAmount;

            fullSellDetails.push({
                product,
                productName,
                amount: quantityAmount,
                quantity,
                unitPrice,
            });
        }

        if (unknownProducts.length > 0) {
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Unknown products',
                unknownProducts,
            );
        }

        return { subtotal, fullSellDetails };
    }
}
