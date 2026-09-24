import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Product } from './product.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
    GetAllDto,
    GetDto,
    NewProductsDto,
    NewProductFields,
    UpdateBulkDto,
    EnsureValidDto,
    MatchesDto,
} from './types';
import { runInTransaction } from '../common/utils/db';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { AuthUser } from '../auth/types';
import { EanCounterService } from '../ean-counter/ean-counter.service';
import { ErrorCode, NotFoundError, ValidationError } from '../common/errors';

/** Most rows `GET /products/matches` returns: it feeds a pick list. */
export const MAX_MATCHES = 10;

/** Escapes user input so it matches literally inside a `$regex`. */
export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class ProductService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(Product.name) private model: Model<Product>,
        private inventoryService: InventoryService,
        private EANCounterService: EanCounterService,
    ) {}

    async getByBarcode(dto: GetDto): Promise<Product> {
        Logger.log('BARCODE');
        const { EAN } = dto;

        const product = await this.model.findOne({ EAN }).lean();

        if (!product) {
            throw new NotFoundError(
                ErrorCode.PRODUCT_NOT_FOUND,
                `No Product found`,
            );
        }

        return product;
    }

    async update(dto: UpdateBulkDto, session?: ClientSession): Promise<void> {
        await runInTransaction(
            async (session) => {
                // Not bulkWrite: Mongoose never runs schema validators on
                // bulkWrite updates, so the integer-centavo and min price
                // checks would be skipped. Sequential because operations
                // sharing a transaction session must not run concurrently.
                for (const { product, update } of dto.updates) {
                    await this.model.updateOne(
                        { _id: product },
                        { $set: update },
                        { session, runValidators: true },
                    );
                }
            },
            this.connection,
            session,
        );
    }

    async getMany(products: string[], session?: ClientSession) {
        const unique_ids = [...new Set(products)];

        const found = await this.model
            .find({ _id: { $in: unique_ids } })
            .select('price name')
            .session(session ?? null)
            .lean();

        return new Map(found.map((item) => [item._id.toString(), item]));
    }

    async getAll(
        dto: GetAllDto,
    ): Promise<{ data: Product[]; totalItems: number }> {
        const { page, limit, name, EAN } = dto;

        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = {};
        if (name) {
            query.name = { $regex: `^${escapeRegex(name)}` };
        }
        if (EAN) {
            query.EAN = { $regex: `^${escapeRegex(EAN)}` };
        }

        const [data, totalItems] = await Promise.all([
            this.model
                .find(query)
                .sort({ name: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            query?.name || query?.EAN
                ? this.model.countDocuments(query)
                : this.model.estimatedDocumentCount(),
        ]);

        return {
            data,
            totalItems,
        };
    }

    async getAllExec(
        dto: GetAllDto,
    ): Promise<{ productIds: Types.ObjectId[]; totalItems: number }> {
        const { page, limit, name, EAN } = dto;

        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = {};
        if (name) {
            query.name = { $regex: escapeRegex(name) };
        }
        if (EAN) {
            query.EAN = { $regex: `^${escapeRegex(EAN)}` };
        }

        Logger.log({ query, dto });

        const [data, totalItems] = await Promise.all([
            this.model
                .find(query, '_id')
                .sort({ name: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean() as Promise<Array<{ _id: Types.ObjectId }>>,

            query?.name || query?.EAN
                ? this.model.countDocuments(query)
                : this.model.estimatedDocumentCount(),
        ]);

        const productIds = data.map((x) => x._id);
        Logger.log(data, productIds);

        return {
            productIds,
            totalItems,
        };
    }

    async createMany(dto: NewProductFields[], session: ClientSession) {
        for (const product of dto) {
            if (!product.EAN)
                product.EAN = await this.EANCounterService.generate(session);
        }

        const inserted = await this.model.insertMany(dto, { session });

        const EANMap: Record<string, string> = {};
        inserted.forEach(({ _id, EAN }) => {
            EANMap[EAN] = _id.toString();
        });

        return EANMap;
    }

    async addMany(
        user: AuthUser,
        dto: NewProductsDto,
        session?: ClientSession,
    ) {
        await runInTransaction(
            async (session) => {
                const newProducts = [];
                for (const product of dto.newProducts) {
                    const EAN =
                        product?.EAN ||
                        (await this.EANCounterService.generate(session));

                    newProducts.push({
                        ...product,
                        EAN,
                    });
                }

                Logger.log({ newProducts });
                const inserted = await this.model.insertMany(newProducts, {
                    session,
                });
                const ids = inserted.map((doc) => doc._id);

                await this.inventoryService.createMany(
                    ids,
                    new Types.ObjectId(user.userId),
                    session,
                );
            },
            this.connection,
            session,
        );
    }

    async ensureValid(dto: EnsureValidDto) {
        const { EAN, name, autoGenerateEAN } = dto;
        Logger.log({ dto });
        if (!autoGenerateEAN) {
            this.EANCounterService.ensureValid(EAN);
        }

        const found = await this.model
            .findOne({
                $or: [{ EAN: EAN }, { name: name }],
            })
            .lean();

        Logger.log({ found }, { dto });
        const duplicates: string[] = [];
        if (found) {
            if (!autoGenerateEAN && found.EAN === EAN)
                duplicates.push('EAN already exists');

            if (found.name === name) duplicates.push('name already exists');

            throw new ValidationError(
                ErrorCode.PRODUCT_DUPLICATE,
                'Duplicate product',
                duplicates,
            );
        }
    }

    async getMatches(
        dto: MatchesDto,
    ): Promise<{ EAN: string; name: string; product: string }[]> {
        const { EAN, name } = dto;

        let query: Record<string, unknown>;
        if (EAN) {
            query = { EAN: { $regex: `^${escapeRegex(EAN)}` } };
        } else if (name) {
            // Names are stored lowercase and MatchesDto lowercases the term,
            // so a plain substring match is already case-insensitive.
            const byName = { name: { $regex: escapeRegex(name) } };
            // A digits-only term may also be part of a barcode, e.g. the
            // legible half of a torn label.
            query = /^\d+$/.test(name)
                ? { $or: [byName, { EAN: { $regex: escapeRegex(name) } }] }
                : byName;
        } else {
            return [];
        }

        const matches = (await this.model
            .find(query, 'name EAN')
            .sort({ name: 1 })
            .limit(MAX_MATCHES)
            .lean()) as Array<{
            EAN: string;
            name: string;
            _id: Types.ObjectId;
        }>;

        return matches.map((match) => ({
            EAN: match.EAN,
            name: match.name,
            product: match._id.toString(),
        }));
    }
}
