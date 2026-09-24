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

/** Mongo's duplicate-key error, as thrown by a unique index. */
function isDuplicateKey(err: unknown, field: string): boolean {
    const e = err as { code?: unknown; keyPattern?: Record<string, unknown> };
    return Number(e?.code) === 11000 && !!e.keyPattern && field in e.keyPattern;
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

    async sell(user: AuthUser, dto: SellDto, session?: ClientSession) {
        const { paymentType, referenceNumber } = dto;

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
     * Inserts the sale, turning a reused GCash reference number into a 409.
     * It has to be caught here: inside the transaction the raw Mongo error
     * would otherwise surface as an opaque 500.
     */
    private async createSale(
        doc: Record<string, unknown>,
        session: ClientSession,
    ) {
        try {
            return await this.model.create([doc], { session });
        } catch (err) {
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
            status: SaleStatus.COMPLETED,
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
