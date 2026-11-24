import { SettingsService } from '../settings/settings.service';
import { Inject as InjectSettings } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@grocery-pos/contracts';
import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Product, type ProductDoc } from './product.schema';
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
import {
    barcodeError,
    UnitOfMeasure,
    type Paginated,
    type ProductMatch,
} from '@grocery-pos/contracts';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { AuthUser, Role } from '../auth/types';
import { CategoryService } from '../category/category.service';
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
        @Inject(forwardRef(() => InventoryService))
        private inventoryService: InventoryService,
        private EANCounterService: EanCounterService,
        @Optional()
        @Inject(CategoryService)
        private categories: CategoryService | undefined = undefined,
        private audit: AuditService,
        @InjectSettings(SettingsService)
        private settings: SettingsService,
    ) {}

    async getByBarcode(
        dto: GetDto,
        includeArchived = false,
    ): Promise<ProductDoc> {
        const { EAN } = dto;

        const product = await this.model.findOne({ EAN }).lean<ProductDoc>();

        if (!product) {
            throw new NotFoundError(
                ErrorCode.PRODUCT_NOT_FOUND,
                `No Product found`,
            );
        }

        if (product.isActive === false && !includeArchived)
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Product discontinued',
            );
        return product;
    }

    /** The product plus the register's sellable `stock` hint (#422). */
    async withSellableStock(
        product: ProductDoc,
    ): Promise<ProductDoc & { stock?: number }> {
        const stock = await this.inventoryService.sellableStock(
            product._id,
            product.tracksExpiry === true,
        );
        return stock === undefined ? product : { ...product, stock };
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

        await runInTransaction(
            async (session) => {
                // Not bulkWrite: Mongoose never runs schema validators on
                // bulkWrite updates, so the integer-centavo and min price
                // checks would be skipped. Sequential because operations
                // sharing a transaction session must not run concurrently.
                for (const { product, update } of dto.updates) {
                    const before = await this.model
                        .findById(product)
                        .session(session)
                        .lean<ProductDoc>();
                    if (!before)
                        throw new NotFoundError(
                            ErrorCode.PRODUCT_NOT_FOUND,
                            'Product not found',
                        );
                    if (
                        update.tracksExpiry !== undefined &&
                        update.tracksExpiry !== (before.tracksExpiry === true)
                    )
                        await this.inventoryService.assertTrackingChange(
                            product,
                            session,
                        );
                    if (
                        update.category &&
                        new Types.ObjectId(update.category).toString() !==
                            before.category?.toString()
                    )
                        await this.categories!.assertAssignable(
                            update.category,
                            session,
                        );
                    await this.model.updateOne(
                        { _id: product },
                        {
                            $set: Object.fromEntries(
                                Object.entries(update).filter(
                                    ([key, value]) =>
                                        !(key === 'category' && value === null),
                                ),
                            ),
                            ...(update.category === null && {
                                $unset: { category: 1 },
                            }),
                            ...(update.price !== undefined &&
                                update.price !== before.price && {
                                    $push: {
                                        priceHistory: {
                                            oldPrice: before.price,
                                            newPrice: update.price,
                                            changedBy: user.userId,
                                            at: new Date(),
                                        },
                                    },
                                }),
                        },
                        { session, runValidators: true },
                    );
                    if (
                        update.price !== undefined &&
                        update.price !== before.price
                    )
                        await this.audit.record(
                            {
                                actor: user,
                                action: AuditAction.PRODUCT_PRICE_CHANGED,
                                targetModel: 'Product',
                                targetId: product,
                                before: {
                                    price: before.price,
                                    unit: before.unit,
                                },
                                after: {
                                    price: update.price,
                                    unit: before.unit,
                                },
                            },
                            session,
                        );
                }
            },
            this.connection,
            session,
        );
    }

    /** Receipt writes share the stock transaction; duplicate lines resolve in receipt order. */
    async recordReceiptCosts(
        lines: { product: Types.ObjectId; unitCost: number }[],
        session: ClientSession,
    ): Promise<void> {
        for (const line of lines) {
            await this.model.updateOne(
                { _id: line.product },
                {
                    $set: {
                        lastCost: line.unitCost,
                        costUpdatedAt: new Date(),
                    },
                    $inc: { saleVersion: 1 },
                },
                { session, runValidators: true },
            );
        }
    }

    async getMany(products: string[], session?: ClientSession) {
        const unique_ids = [...new Set(products)];
        // Serialize checkout pricing against edits/archival in the same transaction.
        if (session)
            await this.model.updateMany(
                { _id: { $in: unique_ids } },
                { $inc: { saleVersion: 1 } },
                { session },
            );

        const found = await this.model
            .find({ _id: { $in: unique_ids } })
            .select('price name unit isActive tracksExpiry +lastCost')
            .session(session ?? null)
            .lean();

        return new Map(found.map((item) => [item._id.toString(), item]));
    }

    async getAll(dto: GetAllDto): Promise<Paginated<ProductDoc>> {
        const { page, limit, name, EAN } = dto;

        const skip = (page - 1) * limit;

        const query = {
            ...productSearchFilter({ name, EAN }),
            ...(dto.category && { category: new Types.ObjectId(dto.category) }),
            ...(dto.status === 'all'
                ? {}
                : {
                      isActive:
                          dto.status === 'archived' ? false : { $ne: false },
                  }),
        };

        const [data, totalItems] = await Promise.all([
            this.model
                .find(query)
                .sort({ name: 1 })
                .skip(skip)
                .limit(limit)
                .lean<ProductDoc[]>(),

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

        const defaultLevel = (await this.settings.read(session))
            .defaultReorderLevel;
        const withEANs = [];
        for (const product of products) {
            if (product.category)
                await this.categories!.assertAssignable(
                    product.category,
                    session,
                );
            withEANs.push({
                ...product,
                reorderLevel:
                    product.reorderLevel ??
                    defaultLevel *
                        (product.unit === UnitOfMeasure.KG ||
                        product.unit === UnitOfMeasure.L
                            ? 1000
                            : 1),
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
                await this.assertNoClashes(dto.newProducts, session);
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

    /**
     * Refuses a bulk create naming every clash at once (#470): a name or
     * typed barcode another product already has, or one an earlier entry
     * of the batch has (reported on the later entry). The details have the
     * DB_DUPLICATE_KEY shape, `{ property, msg, index }` per clash, so the
     * client flags every draft; the unique indexes stay the final guard.
     */
    private async assertNoClashes(
        products: NewProductFields[],
        session: ClientSession,
    ): Promise<void> {
        const names = products.map((p) => p.name);
        const EANs = products.map((p) => p.EAN).filter((e): e is string => !!e);
        const existing = await this.model
            .find(
                { $or: [{ name: { $in: names } }, { EAN: { $in: EANs } }] },
                { name: 1, EAN: 1 },
            )
            .session(session)
            .lean();
        const takenNames = new Set(existing.map((p) => p.name));
        const takenEANs = new Set(existing.map((p) => p.EAN));

        const clashes: { property: string; msg: string; index: number }[] = [];
        const seenNames = new Set<string>();
        const seenEANs = new Set<string>();
        products.forEach((product, index) => {
            if (takenNames.has(product.name))
                clashes.push({
                    property: 'name',
                    msg: 'Already exists',
                    index,
                });
            else if (seenNames.has(product.name))
                clashes.push({
                    property: 'name',
                    msg: 'Repeated in this list',
                    index,
                });
            seenNames.add(product.name);

            if (!product.EAN) return;
            if (takenEANs.has(product.EAN))
                clashes.push({ property: 'EAN', msg: 'Already exists', index });
            else if (seenEANs.has(product.EAN))
                clashes.push({
                    property: 'EAN',
                    msg: 'Repeated in this list',
                    index,
                });
            seenEANs.add(product.EAN);
        });

        if (clashes.length > 0) {
            throw new ValidationError(
                ErrorCode.DB_DUPLICATE_KEY,
                'Duplicate key',
                clashes,
            );
        }
    }

    /**
     * Throws when a product draft would be refused: a typed barcode that
     * breaks the create rules, or a barcode or name that already exists.
     * With `autoGenerateEAN` the barcode is not checked at all: the client
     * omits it (issue #33), and a leftover typed value is ignored.
     */
    async ensureValid(dto: EnsureValidDto) {
        const { EAN, name, autoGenerateEAN } = dto;
        const checkEAN = !autoGenerateEAN;
        if (checkEAN) {
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

        // Only the fields being checked. An absent one must not reach the
        // filter: `{ EAN: undefined }` is sent as `{}`, which matches every
        // product and would report any draft as a duplicate (issue #33).
        const clauses: Record<string, string>[] = [];
        if (checkEAN) clauses.push({ EAN });
        if (name) clauses.push({ name });
        if (clauses.length === 0) return;

        // Every match: the name and the barcode may belong to two
        // different products, and both are reported (#470).
        const found = await this.model
            .find({ $or: clauses }, { name: 1, EAN: 1 })
            .limit(2)
            .lean();

        if (found.length > 0) {
            const duplicates: string[] = [];
            if (checkEAN && found.some((p) => p.EAN === EAN))
                duplicates.push('EAN already exists');

            if (name && found.some((p) => p.name === name))
                duplicates.push('name already exists');

            throw new ValidationError(
                ErrorCode.PRODUCT_DUPLICATE,
                'Duplicate product',
                duplicates,
            );
        }
    }

    async getMatches(dto: MatchesDto): Promise<ProductMatch[]> {
        const { EAN, name, withStock } = dto;

        let query: Record<string, unknown>;
        if (EAN) {
            query = { EAN: prefixRegex(EAN) };
        } else if (name) {
            // Names are stored uppercase and MatchesDto uppercases the term,
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
            .find(
                { ...query, isActive: { $ne: false } },
                withStock
                    ? 'name EAN unit tracksExpiry reorderLevel'
                    : 'name EAN unit tracksExpiry',
            )
            .sort({ name: 1 })
            .limit(MAX_MATCHES)
            .lean()) as Array<{
            EAN: string;
            name: string;
            _id: Types.ObjectId;
            unit?: UnitOfMeasure;
            tracksExpiry?: boolean;
            reorderLevel?: number;
        }>;

        const stocks = withStock
            ? await this.inventoryService.sellableStocks(matches)
            : new Map<string, number>();

        return matches.map((match) => {
            const stock = stocks.get(match._id.toString());
            return {
                EAN: match.EAN,
                name: match.name,
                product: match._id.toString(),
                ...(match.tracksExpiry !== undefined && {
                    tracksExpiry: match.tracksExpiry,
                }),
                ...(match.unit && { unit: match.unit }),
                ...(stock !== undefined && { stock }),
                ...(withStock &&
                    match.reorderLevel !== undefined && {
                        reorderLevel: match.reorderLevel,
                    }),
            };
        });
    }
}
