import { receiptCost } from './cost';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Supplier, type SupplierDoc } from './supplier.schema';
import {
    SupplierFieldsDto,
    SupplierQueryDto,
    UpdateSupplierDto,
} from './supplier.dto';
import { Restock } from '../inventory-man/restock/restock.schema';
import { Product, type ProductDoc } from '../product/product.schema';
import { ErrorCode, NotFoundError, ValidationError } from '../common/errors';
import { runInTransaction } from '../common/utils/db';
import { containsRegex } from '../common/utils/regex';
import type { ProductCostView } from '@grocery-pos/contracts';

@Injectable()
export class SupplierService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(Supplier.name) private suppliers: Model<Supplier>,
        @InjectModel(Restock.name) private restocks: Model<Restock>,
        @InjectModel(Product.name) private products: Model<Product>,
    ) {}
    async list(dto: SupplierQueryDto) {
        const filter = {
            ...(dto.status === 'all'
                ? {}
                : { isActive: dto.status !== 'archived' }),
            ...(dto.name
                ? { name: { ...containsRegex(dto.name), $options: 'i' } }
                : {}),
        };
        const [data, totalItems] = await Promise.all([
            this.suppliers
                .find(filter)
                .sort({ name: 1, _id: 1 })
                .skip((dto.page - 1) * dto.limit)
                .limit(dto.limit)
                .lean<SupplierDoc[]>(),
            this.suppliers.countDocuments(filter),
        ]);
        return { data, totalItems };
    }
    async create(dto: SupplierFieldsDto) {
        const row = await this.suppliers.create(dto);
        return this.suppliers.findById(row._id).lean<SupplierDoc>().orFail();
    }
    async update(id: string, dto: UpdateSupplierDto) {
        return runInTransaction(async (session) => {
            const row = await this.suppliers
                .findByIdAndUpdate(
                    id,
                    { $set: dto, $inc: { receiptVersion: 1 } },
                    { new: true, runValidators: true, session },
                )
                .lean<SupplierDoc>();
            if (!row)
                throw new NotFoundError(
                    ErrorCode.NOT_FOUND,
                    'Supplier not found',
                );
            return row;
        }, this.connection);
    }
    async remove(id: string) {
        await runInTransaction(async (session) => {
            const row = await this.suppliers.findByIdAndUpdate(
                id,
                { $inc: { receiptVersion: 1 } },
                { session },
            );
            if (!row)
                throw new NotFoundError(
                    ErrorCode.NOT_FOUND,
                    'Supplier not found',
                );
            if (
                await this.restocks
                    .exists({ supplier: new Types.ObjectId(id) })
                    .session(session)
            )
                throw new ValidationError(
                    ErrorCode.VALIDATION_INVALID_INPUT,
                    'Supplier has receipt history; archive it instead',
                );
            await this.suppliers.deleteOne({ _id: id }, { session });
        }, this.connection);
    }
    async assertActive(id: string, session: ClientSession) {
        const result = await this.suppliers.updateOne(
            { _id: id, isActive: true },
            { $inc: { receiptVersion: 1 } },
            { session },
        );
        if (result.matchedCount !== 1)
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Choose an active supplier',
            );
    }
    async costs(ids: string[], margin: boolean): Promise<ProductCostView[]> {
        const rows = await this.products
            .find({ _id: { $in: ids } })
            .select('+lastCost +costUpdatedAt')
            .lean<ProductDoc[]>();
        return rows.map((row) => {
            const basis = receiptCost(row.lastCost);
            return {
                product: String(row._id),
                ...(basis !== undefined && { lastCost: basis }),
                ...(row.costUpdatedAt && {
                    costUpdatedAt: row.costUpdatedAt.toISOString(),
                }),
                ...(margin &&
                    basis !== undefined && {
                        marginBasisPoints: Number(
                            (BigInt(row.price - basis) * 10000n) /
                                BigInt(row.price),
                        ),
                    }),
            };
        });
    }
}
