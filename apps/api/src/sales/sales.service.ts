import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Sales } from './sales.schema';
import { ClientSession, Connection, Model } from 'mongoose';
import { SalesDetails } from './sales-details.schema';
import {
    DiscountType,
    GetAllDto,
    GetDetailsDto,
    ReceiptDiscount,
    ReceiptDto,
    ReceiptFields,
    SellDto,
} from './types';
import { discountAmount } from '@grocery-pos/contracts';
import { DISCOUNT_LIMITS, NUMERIC_LIMITS } from '../constants';
import { ProductService } from '../product/product.service';
import { runInTransaction } from '../common/utils/db';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { AuthUser } from '../auth/types';
import { ErrorCode, ValidationError } from '../common/errors';

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

        const { fullSellDetails, subtotal, discount, totalAmount } =
            await runInTransaction(
                async (session) => {
                    const { subtotal, fullSellDetails } =
                        await this.prepareSell(dto, session);
                    const { discount, totalAmount } = this.applyDiscount(
                        subtotal,
                        dto,
                    );

                    const [created] = await this.model.create(
                        [
                            {
                                amount: totalAmount,
                                cashier: user.userId,
                                paymentType,
                                referenceNumber,
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
                        ],
                        { session },
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

                    return { fullSellDetails, subtotal, discount, totalAmount };
                },
                this.connection,
                session,
            );

        return this.makeReceipt(
            fullSellDetails,
            user.username,
            subtotal,
            discount,
            totalAmount,
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

    private makeReceipt(
        itemsInfo: ReceiptFields[],
        cashierName: string,
        subtotal: number,
        discount: ReceiptDiscount | null,
        totalAmount: number,
    ): ReceiptDto {
        const items: ReceiptFields[] = itemsInfo.map(
            ({ productName, quantity, amount }) => ({
                productName,
                quantity,
                amount,
            }),
        );

        return {
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
