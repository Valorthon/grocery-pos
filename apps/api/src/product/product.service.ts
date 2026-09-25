import { Injectable } from '@nestjs/common';
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
import { containsRegex, prefixRegex } from '../common/utils/regex';
import { productSearchFilter } from './product-search';
import { barcodeError } from '@grocery-pos/contracts';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { AuthUser, Role } from '../auth/types';
import { EanCounterService } from '../ean-counter/ean-counter.service';
import {
    ErrorCode,
    ForbiddenError,
    NotFoundError,
    ValidationError,
} from '../common/errors';

/** Most rows `GET /products/matches` returns: it feeds a pick list. */
export const MAX_MATCHES = 10;

/**
 * Throws a 403 PRODUCT_PRICE_CHANGE_FORBIDDEN if `dto` changes a price and
 * `user` is not an ADMIN. Setting the first price of a new product
 * (`POST /products/bulk`, or a new product created by a restock) is not a
 * price change and stays open to restockers; a restock never writes the
 * price of an existing product (it records `unitCost`, the purchase cost).
 */
export function assertMayChangePrices(user: AuthUser, dto: UpdateBulkDto) {
    if (user.roles.includes(Role.Admin)) return;

    const products = dto.updates
        .filter(({ update }) => update.price !== undefined)
        .map(({ product }) => product);

    if (products.length > 0) {
        throw new ForbiddenError(
            ErrorCode.PRODUCT_PRICE_CHANGE_FORBIDDEN,
            'Only an admin can change prices',
            { products },
        );
    }
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

    /**
     * Applies a batch of product edits, all or nothing.
     *
     * Price changes are ADMIN-only (issue #13). A batch from anyone else
     * that sets `price` on any product is refused whole with a 403
     * PRODUCT_PRICE_CHANGE_FORBIDDEN before anything is written, even if
     * the price equals the current one: applying only the non-price edits
     * would silently drop part of what the caller asked for.
     */
    async update(
        user: AuthUser,
        dto: UpdateBulkDto,
        session?: ClientSession,
    ): Promise<void> {
        assertMayChangePrices(user, dto);

        // TODO(#46): record each price change (product, old and new price,
        // who) in the audit log inside this transaction.
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

        const query = productSearchFilter({ name, EAN });

        const [data, totalItems] = await Promise.all([
            this.model
                .find(query)
                .sort({ name: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            // Exact: the total is shown to the user (issue #16).
            this.model.countDocuments(query),
        ]);

        return {
            data,
            totalItems,
        };
    }

    /**
     * The new products as they will be inserted: a copy of each, with its
     * barcode checked or, if it has none, one generated from the counter.
     *
     * Never writes to the caller's objects. `runInTransaction` retries the
     * whole callback on a transient error, rolling the counter back; a
     * generated EAN written into the DTO would be reused on the retry while
     * the counter is back at N-1, and a later `generate()` would collide.
     */
    private async withEANs(
        products: NewProductFields[],
        session: ClientSession,
    ): Promise<(NewProductFields & { EAN: string })[]> {
        const invalid = products
            .map((product, index) => ({
                index,
                EAN: product.EAN,
                message: product.EAN ? barcodeError(product.EAN) : null,
            }))
            .filter((entry) => entry.message !== null);
        if (invalid.length > 0) {
            throw new ValidationError(
                ErrorCode.VALIDATION_EAN_INVALID,
                'Invalid barcode',
                invalid,
            );
        }

        const withEANs = [];
        for (const product of products) {
            withEANs.push({
                ...product,
                EAN:
                    product.EAN ||
                    (await this.EANCounterService.generate(session)),
            });
        }
        return withEANs;
    }

    /**
     * Inserts new products (no inventory rows: a restock upserts those) and
     * returns their ids in the order given. The caller's DTO is not changed.
     */
    async createMany(
        products: NewProductFields[],
        session: ClientSession,
    ): Promise<Types.ObjectId[]> {
        if (products.length === 0) return [];

        const inserted = await this.model.insertMany(
            await this.withEANs(products, session),
            { session },
        );

        return inserted.map((doc) => doc._id);
    }

    async addMany(
        user: AuthUser,
        dto: NewProductsDto,
        session?: ClientSession,
    ) {
        await runInTransaction(
            async (session) => {
                const newProducts = await this.withEANs(
                    dto.newProducts,
                    session,
                );

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
        if (!autoGenerateEAN) {
            // The same rules as the create and import DTOs (IsBarcode).
            const message = EAN
                ? barcodeError(EAN)
                : 'Barcode is required unless it is auto-generated';
            if (message) {
                throw new ValidationError(
                    ErrorCode.VALIDATION_EAN_INVALID,
                    message,
                );
            }
        }

        const found = await this.model
            .findOne({
                $or: [{ EAN: EAN }, { name: name }],
            })
            .lean();

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
            query = { EAN: prefixRegex(EAN) };
        } else if (name) {
            // Names are stored lowercase and MatchesDto lowercases the term,
            // so a plain substring match is already case-insensitive.
            const byName = { name: containsRegex(name) };
            // A digits-only term may also be part of a barcode, e.g. the
            // legible half of a torn label.
            query = /^\d+$/.test(name)
                ? { $or: [byName, { EAN: containsRegex(name) }] }
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
