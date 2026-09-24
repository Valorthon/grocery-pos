import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Sales } from './sales.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { SalesDetails } from './sales-details.schema';
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
import { discountAmount, REVERSAL_STATUS } from '@grocery-pos/contracts';
import {
    DISCOUNT_LIMITS,
    NUMERIC_LIMITS,
    REVERSED_SALE_STATUSES,
} from '../constants';
import { ProductService } from '../product/product.service';
import { runInTransaction } from '../common/utils/db';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { AuthUser } from '../auth/types';
import {
    ConflictError,
    ErrorCode,
    NotFoundError,
    ValidationError,
} from '../common/errors';
import { Settlement, settleTenders } from './tender';
import { isDuplicateKey, saleRequestHash } from './idempotency';

@Injectable()
export class SalesService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(Sales.name) private model: Model<Sales>,
        @InjectModel(SalesDetails.name)
        private modelDetails: Model<SalesDetails>,
        private productService: ProductService,
        private inventoryService: InventoryService,
    ) {}

    async getAll(
        dto: GetAllDto,
    ): Promise<{ data: Sales[]; totalItems: number }> {
        const { page, limit } = dto;

        const skip = (page - 1) * limit;

        const [data, totalItems] = await Promise.all([
            this.model
                .find()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate({
                    path: 'cashier',
                    select: 'name',
                })
                .lean(),

            this.model.estimatedDocumentCount(),
        ]);

        return {
            data,
            totalItems,
        };
    }

    async getDetails(dto: GetDetailsDto): Promise<SalesDetails[]> {
        const { sales } = dto;

        return await this.modelDetails
            .find({ sales })
            .populate({
                path: 'product',
                select: 'name',
            })
            .lean();
    }

    /**
     * Records a sale, idempotently on `dto.idempotencyKey`.
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
     * null if there is none. Throws a 409 if that sale was recorded by a
     * different request. The request hash covers the cashier, so a matching
     * sale is always the requesting user's own.
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
            throw new ConflictError(
                ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
                'This checkout was already recorded as a different sale. Check Sales History before charging again.',
                { sale: String(sale._id) },
            );
        }

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
                await this.inventoryService.sell(dto, session);

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
     * why, and puts every sold unit back into inventory, all in one
     * transaction. Void and refund differ only in meaning (a mis-ring vs a
     * customer return). Partial / per-line refunds are not supported.
     */
    async reverse(
        user: AuthUser,
        saleId: string,
        { type, reason }: ReverseSaleInput,
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
                    .lean();

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

                const lines = await this.modelDetails
                    .find({ sales: saleId }, { product: 1, quantity: 1 })
                    .session(session)
                    .lean();

                await this.inventoryService.returnStock(
                    lines.map(({ product, quantity }) => ({
                        product: product as Types.ObjectId,
                        quantity,
                    })),
                    session,
                );

                return sale;
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
