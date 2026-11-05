import { SettingsService } from '../settings/settings.service';
import {
    Inject as InjectSettings,
    Optional as OptionalSettings,
} from '@nestjs/common';
import { StockMovementService } from '../stock-movement/stock-movement.service';
import { StockMovementType, StockMovementSource } from '@grocery-pos/contracts';
import { receiptCost } from '../supplier/cost';
import { OfflineCost } from './offline-cost.schema';
import { InventoryBatchService } from '../inventory-man/batch/batch.service';
import { Optional } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { createHash } from 'node:crypto';
import {
    ErrorCode,
    NUMERIC_LIMITS,
    PaymentType,
    Role,
    SaleStatus,
    ShiftStatus,
    TenderType,
    UnitOfMeasure,
    receiptStoreIdentity,
    maxQuantityForAmount,
    quantityAmount,
    type AuthUser,
    type OfflineCatalogPage,
    type OfflineLeaseView,
    type OfflineProduct,
    type OfflineSaleRequest,
} from '@grocery-pos/contracts';
import { OfflineLease } from './offline-lease.schema';
import { Product, type ProductDoc } from '../product/product.schema';
import { User } from '../user/user.schema';
import { Shift } from '../shift/shift.schema';
import { Inventory } from '../inventory-man/inventory/inventory.schema';
import { RefreshToken } from '../auth/refresh-token/refresh-token.schema';
import { Sales } from '../sales/sales.schema';
import { SalesDetails } from '../sales/sales-details.schema';
import type { ReceiptDto } from '../sales/types/sales.dto';
import { SalesService } from '../sales/sales.service';
import { toCurrentView } from '../shift/shift.service';
import {
    ConflictError,
    ForbiddenError,
    InternalError,
    ValidationError,
} from '../common/errors';
import { runInTransaction } from '../common/utils/db';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import {
    OfflineCatalogDto,
    OfflineLeaseDto,
    OfflineSaleDto,
    ReconcileOfflineSaleDto,
} from './offline.dto';

const AUDIENCE = 'grocery-pos-offline-price-v1';
type LeaseDoc = OfflineLease & { _id: Types.ObjectId };
interface PriceProof {
    purpose: 'offline-price-v1';
    costRef?: string;
    lease: string;
    cashier: string;
    shift: string;
    product: string;
    EAN: string;
    price: number;
    unit: UnitOfMeasure;
    iat: number;
    exp: number;
}
const invalid = () =>
    new ConflictError(
        ErrorCode.OFFLINE_INVALID,
        'Offline price or shift authorization is invalid. Keep the pending sale and ask an admin to review it.',
    );
const reconcile = () =>
    new ConflictError(
        ErrorCode.OFFLINE_RECONCILIATION_REQUIRED,
        'This collected cash sale needs admin reconciliation because its shift, session or cashier authorization changed. It remains saved on this terminal.',
    );
const canonicalId = (id: string) => new Types.ObjectId(id).toString();
export function offlineRequestHash(
    cashier: string,
    dto: OfflineSaleRequest,
): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                kind: 'offline-v1',
                cashier,
                lease: canonicalId(dto.lease),
                soldAt: new Date(dto.soldAt).toISOString(),
                amountTendered: dto.amountTendered,
                lines: dto.lines
                    .map((l) => ({
                        product: canonicalId(l.product),
                        quantity: l.quantity,
                        proof: l.proof,
                    }))
                    .sort((a, b) => a.product.localeCompare(b.product)),
            }),
        )
        .digest('hex');
}
@Injectable()
export class OfflineService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(OfflineLease.name) private leases: Model<OfflineLease>,
        @InjectModel(Product.name) private products: Model<Product>,
        @InjectModel(User.name) private users: Model<User>,
        @InjectModel(Shift.name) private shifts: Model<Shift>,
        @InjectModel(Inventory.name) private inventory: Model<Inventory>,
        @InjectModel(RefreshToken.name) private sessions: Model<RefreshToken>,
        @InjectModel(Sales.name) private sales: Model<Sales>,
        @InjectModel(SalesDetails.name) private details: Model<SalesDetails>,
        private receipts: SalesService,
        private jwt: JwtService,
        private config: TypedConfigService,
        @InjectModel(OfflineCost.name) private costQuotes: Model<OfflineCost>,
        @Optional() private batches?: InventoryBatchService,
        @Optional() private ledger?: StockMovementService,
        @OptionalSettings()
        @InjectSettings(SettingsService)
        private settings?: SettingsService,
    ) {}

    private async currentSession(actor: AuthUser, session?: ClientSession) {
        if (!actor.sid || !Types.ObjectId.isValid(actor.sid)) return null;
        return this.sessions
            .findOne({
                user: actor.userId,
                family: actor.sid,
                expiry: { $gt: new Date() },
            })
            .session(session ?? null)
            .lean();
    }
    private async seller(actor: AuthUser, session?: ClientSession) {
        const user = await this.users
            .findOne({ _id: actor.userId, isActive: true, roles: Role.Seller })
            .select('+overridePinVersion')
            .session(session ?? null)
            .lean();
        if (!user) throw reconcile();
        return user;
    }
    async lease(
        actor: AuthUser,
        dto: OfflineLeaseDto,
    ): Promise<OfflineLeaseView> {
        return runInTransaction(async (session) => {
            const store = await this.settings?.lockContext(session);
            const user = await this.seller(actor, session);
            const auth = await this.currentSession(actor, session);
            if (!auth) throw reconcile();
            // A write serializes issuance against normal and forced close.
            const shift = await this.shifts
                .findOneAndUpdate(
                    { cashier: actor.userId, status: ShiftStatus.OPEN },
                    { $inc: { offlineLeaseLock: 1 } },
                    { new: true, session },
                )
                .lean();
            if (!shift) throw reconcile();
            const filter = {
                cashier: user._id,
                shift: shift._id,
                sid: actor.sid!,
                terminalId: dto.terminalId,
                active: true,
            };
            await this.leases.updateMany(
                {
                    cashier: user._id,
                    shift: shift._id,
                    terminalId: dto.terminalId,
                    sid: { $ne: actor.sid },
                    active: true,
                },
                { $set: { active: false } },
                { session },
            );
            const existing = await this.leases
                .findOne(filter)
                .session(session)
                .lean<LeaseDoc>();
            const doc =
                existing ??
                (
                    await this.leases.create(
                        [
                            {
                                ...filter,
                                issuedAt: new Date(),
                                expiresAt: auth.expiry,
                                securityVersion: user.overridePinVersion,
                                ...(store
                                    ? {
                                          storeIdentity: receiptStoreIdentity(
                                              store,
                                              shift.terminal,
                                          ),
                                      }
                                    : {}),
                            },
                        ],
                        { session },
                    )
                )[0];
            if (doc.expiresAt.getTime() <= Date.now()) throw reconcile();
            return {
                ...(doc.storeIdentity
                    ? { storeIdentity: doc.storeIdentity }
                    : {}),
                _id: String(doc._id),
                cashier: actor.userId,
                cashierName: user.name,
                issuedAt: doc.issuedAt.toISOString(),
                expiresAt: doc.expiresAt.toISOString(),
                shift: toCurrentView(shift),
            };
        }, this.connection);
    }
    async catalog(
        actor: AuthUser,
        dto: OfflineCatalogDto,
    ): Promise<OfflineCatalogPage> {
        const user = await this.seller(actor);
        const lease = await this.leases
            .findOne({
                _id: dto.lease,
                cashier: actor.userId,
                sid: actor.sid,
                active: true,
                expiresAt: { $gt: new Date() },
            })
            .lean<LeaseDoc>();
        if (
            !lease ||
            lease.securityVersion !== user.overridePinVersion ||
            !(await this.currentSession(actor))
        )
            throw reconcile();
        const shift = await this.shifts.exists({
            _id: lease.shift,
            status: ShiftStatus.OPEN,
        });
        if (!shift) throw reconcile();
        let cursor: { at: Date; id: Types.ObjectId } | undefined;
        if (dto.after) {
            const [at, id] = dto.after.split('|');
            if (
                !at ||
                !id ||
                !Number.isFinite(Date.parse(at)) ||
                !Types.ObjectId.isValid(id)
            )
                throw invalid();
            cursor = { at: new Date(at), id: new Types.ObjectId(id) };
        }
        const limit = dto.limit ?? 100;
        const rows = await this.products
            .find(
                cursor
                    ? {
                          $or: [
                              { updatedAt: { $gt: cursor.at } },
                              { updatedAt: cursor.at, _id: { $gt: cursor.id } },
                          ],
                      }
                    : {},
            )
            .select('+lastCost')
            .sort({ updatedAt: 1, _id: 1 })
            .limit(limit)
            .lean<ProductDoc[]>();
        const products: OfflineProduct[] = [];
        for (const product of rows) {
            if (
                !Number.isSafeInteger(product.price) ||
                product.price < 1 ||
                product.price > NUMERIC_LIMITS.AMOUNT_MAX
            )
                throw new InternalError('Invalid cached product price');
            const unit = product.unit ?? UnitOfMeasure.PIECE;
            const costBasis = receiptCost(product.lastCost);
            // Store the confidential procurement basis only on the server.
            const costQuote =
                product.isActive === false || product.tracksExpiry === true
                    ? undefined
                    : await this.costQuotes.create({
                          lease: lease._id,
                          product: product._id,
                          unit,
                          ...(costBasis !== undefined && {
                              unitCost: costBasis,
                          }),
                      });
            const proof =
                product.isActive === false || product.tracksExpiry === true
                    ? ''
                    : this.jwt.sign(
                          {
                              purpose: 'offline-price-v1',
                              costRef: String(costQuote!._id),
                              lease: String(lease._id),
                              cashier: actor.userId,
                              shift: String(lease.shift),
                              product: String(product._id),
                              EAN: product.EAN,
                              price: product.price,
                              unit,
                          },
                          {
                              secret: this.config.get('JWT_SECRET'),
                              audience: AUDIENCE,
                              expiresIn: Math.max(
                                  1,
                                  Math.floor(
                                      (lease.expiresAt.getTime() - Date.now()) /
                                          1000,
                                  ),
                              ),
                          },
                      );
            products.push({
                ...((product.isActive === false ||
                    product.tracksExpiry === true) && { isActive: false }),
                _id: String(product._id),
                EAN: product.EAN,
                name: product.name,
                price: product.price,
                unit,
                updatedAt: product.updatedAt.toISOString(),
                proof,
            });
        }
        const last = rows[rows.length - 1];
        return {
            products,
            next:
                rows.length === limit && last
                    ? `${last.updatedAt.toISOString()}|${String(last._id)}`
                    : null,
        };
    }
    async release(
        actor: AuthUser,
        id: string,
        dto: OfflineLeaseDto,
    ): Promise<void> {
        await runInTransaction(async (session) => {
            await this.seller(actor, session);
            if (!(await this.currentSession(actor, session))) throw reconcile();
            const lease = await this.leases
                .findOne({
                    _id: id,
                    cashier: actor.userId,
                    terminalId: dto.terminalId,
                })
                .session(session)
                .lean();
            if (!lease) throw invalid();
            // This write conflicts with a simultaneous sync/issue/close.
            await this.shifts.updateOne(
                { _id: lease.shift },
                { $inc: { offlineLeaseLock: 1 } },
                { session },
            );
            await this.leases.updateOne(
                { _id: id },
                { $set: { active: false }, $inc: { syncLock: 1 } },
                { session },
            );
        }, this.connection);
    }
    private proof(
        token: string,
        lease: LeaseDoc,
        product: string,
        soldAt: Date,
    ): PriceProof {
        let p: PriceProof;
        try {
            p = this.jwt.verify<PriceProof>(token, {
                secret: this.config.get('JWT_SECRET'),
                audience: AUDIENCE,
                algorithms: ['HS256'],
                ignoreExpiration: true,
            });
        } catch {
            throw invalid();
        }
        if (
            p.purpose !== 'offline-price-v1' ||
            p.lease !== String(lease._id) ||
            p.cashier !== String(lease.cashier) ||
            p.shift !== String(lease.shift) ||
            p.product !== canonicalId(product) ||
            !Object.values(UnitOfMeasure).includes(p.unit) ||
            !Number.isSafeInteger(p.price) ||
            p.price < 1 ||
            p.price > NUMERIC_LIMITS.AMOUNT_MAX ||
            !Number.isFinite(p.iat) ||
            !Number.isFinite(p.exp) ||
            soldAt.getTime() < p.iat * 1000 ||
            soldAt.getTime() > p.exp * 1000 ||
            p.exp * 1000 > lease.expiresAt.getTime() + 1000
        )
            throw invalid();
        return p;
    }
    async sync(
        actor: AuthUser,
        dto: OfflineSaleDto | ReconcileOfflineSaleDto,
        admin = false,
    ): Promise<ReceiptDto> {
        const lease = await this.leases.findById(dto.lease).lean<LeaseDoc>();
        if (!lease || (!admin && String(lease.cashier) !== actor.userId))
            throw invalid();
        const hash = offlineRequestHash(String(lease.cashier), dto);
        const replay = async () => {
            const found = await this.sales
                .findOne({ idempotencyKey: dto.idempotencyKey })
                .lean();
            if (!found) return null;
            if (
                found.requestHash !== hash ||
                !(found.cashier instanceof Types.ObjectId) ||
                !found.cashier.equals(lease.cashier)
            )
                throw new ConflictError(
                    ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
                    'This offline receipt key already belongs to another sale. Keep the pending entry for admin review.',
                );
            const cashier = await this.users.findById(lease.cashier).lean();
            return this.receipts.receiptOf(found, {
                ...actor,
                userId: String(lease.cashier),
                username: cashier?.name ?? 'Former cashier',
            });
        };
        const recorded = await replay();
        if (recorded) return recorded;
        const soldAt = new Date(dto.soldAt);
        if (
            !Number.isFinite(soldAt.getTime()) ||
            soldAt.getTime() < lease.issuedAt.getTime() - 1000 ||
            soldAt.getTime() > lease.expiresAt.getTime() ||
            soldAt.getTime() > Date.now() + 120000
        )
            throw invalid();
        const lines = dto.lines.map((line) => ({
            ...line,
            product: canonicalId(line.product),
            attested: this.proof(line.proof, lease, line.product, soldAt),
        }));
        if (new Set(lines.map((l) => l.product)).size !== lines.length)
            throw invalid();
        let subtotal = 0;
        for (const line of lines) {
            if (
                !Number.isSafeInteger(line.quantity) ||
                line.quantity < 1 ||
                line.quantity >
                    maxQuantityForAmount(
                        NUMERIC_LIMITS.AMOUNT_MAX - subtotal,
                        line.attested.price,
                        line.attested.unit,
                    )
            )
                throw invalid();
            subtotal += quantityAmount(
                line.attested.price,
                line.quantity,
                line.attested.unit,
            );
        }
        if (
            subtotal < 1 ||
            dto.amountTendered < subtotal ||
            dto.amountTendered > NUMERIC_LIMITS.AMOUNT_MAX
        )
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Offline cash tender does not cover the verified total',
            );
        try {
            const saleId = await runInTransaction(async (session) => {
                const cashier = await this.users
                    .findById(lease.cashier)
                    .select('+overridePinVersion')
                    .session(session)
                    .lean();
                const shift = await this.shifts
                    .findById(lease.shift)
                    .session(session)
                    .lean();
                if (
                    !cashier ||
                    !shift ||
                    String(shift.cashier) !== String(lease.cashier)
                )
                    throw invalid();
                if (admin) {
                    const approver = await this.users
                        .findOne({
                            _id: actor.userId,
                            isActive: true,
                            roles: Role.Admin,
                        })
                        .session(session)
                        .lean();
                    if (!approver || !('reason' in dto) || !dto.reason.trim())
                        throw new ForbiddenError(
                            ErrorCode.FORBIDDEN,
                            'An active admin and a reconciliation reason are required',
                        );
                    await this.users.updateOne(
                        { _id: actor.userId },
                        { $inc: { overrideApprovalLock: 1 } },
                        { session },
                    );
                } else {
                    if (
                        !cashier.isActive ||
                        !cashier.roles.includes(Role.Seller) ||
                        actor.sid !== lease.sid ||
                        cashier.overridePinVersion !== lease.securityVersion ||
                        shift.status !== ShiftStatus.OPEN ||
                        !lease.active ||
                        lease.expiresAt.getTime() <= Date.now() ||
                        !(await this.currentSession(actor, session))
                    )
                        throw reconcile();
                }
                await this.users.updateOne(
                    { _id: cashier._id },
                    { $inc: { overrideApprovalLock: 1 } },
                    { session },
                );
                const currentLease = await this.leases.updateOne(
                    { _id: lease._id, ...(admin ? {} : { active: true }) },
                    { $inc: { syncLock: 1 } },
                    { session },
                );
                if (currentLease.matchedCount !== 1) throw reconcile();
                // Locks an open shift against close. Closed shifts get no modified Z-read.
                if (shift.status === ShiftStatus.OPEN) {
                    const charged = await this.shifts.updateOne(
                        { _id: shift._id, status: ShiftStatus.OPEN },
                        { $inc: { saleCount: 1 } },
                        { session },
                    );
                    if (charged.matchedCount !== 1) throw reconcile();
                }
                if (admin && shift.status !== ShiftStatus.OPEN)
                    await this.shifts.updateOne(
                        { _id: shift._id },
                        { $inc: { lateOfflineCount: 1 } },
                        { session },
                    );
                let shortfall = false;
                for (const line of lines) {
                    await this.products.updateOne(
                        { _id: line.product },
                        { $inc: { saleVersion: 1 } },
                        { session },
                    );
                    const product = await this.products
                        .findById(line.product)
                        .session(session)
                        .lean();
                    if (
                        !product ||
                        (product.unit ?? UnitOfMeasure.PIECE) !==
                            line.attested.unit ||
                        (!admin && product.EAN !== line.attested.EAN)
                    )
                        throw invalid();
                    if (product.tracksExpiry && !admin) throw reconcile();
                    const current = await this.inventory
                        .findOne({ product: line.product })
                        .session(session)
                        .lean();
                    const stock = current?.stock ?? 0;
                    if (
                        !Number.isSafeInteger(stock) ||
                        !Number.isSafeInteger(stock - line.quantity)
                    )
                        throw new InternalError('Invalid inventory quantity');
                    shortfall ||= stock < line.quantity;
                    await this.inventory.updateOne(
                        { product: line.product },
                        {
                            $inc: { stock: -line.quantity },
                            $set: {
                                updatedBy: cashier._id,
                                ...(stock < line.quantity
                                    ? { offlineShortfall: true }
                                    : {}),
                            },
                        },
                        { session, upsert: true },
                    );
                    if (product.tracksExpiry)
                        await this.batches!.reconcileOffline(
                            new Types.ObjectId(line.product),
                            line.quantity,
                            session,
                        );
                }
                const [sale] = await this.sales.create(
                    [
                        {
                            ...(lease.storeIdentity
                                ? { storeIdentity: lease.storeIdentity }
                                : {}),
                            cashier: cashier._id,
                            shift: shift._id,
                            amount: subtotal,
                            paymentType: PaymentType.CASH,
                            tenders: [
                                {
                                    type: TenderType.CASH,
                                    amount: dto.amountTendered,
                                },
                            ],
                            amountTendered: dto.amountTendered,
                            changeGiven: dto.amountTendered - subtotal,
                            status: SaleStatus.COMPLETED,
                            idempotencyKey: dto.idempotencyKey,
                            requestHash: hash,
                            soldAt,
                            offline: true,
                            stockShortfall: shortfall,
                            ...(admin
                                ? {
                                      reconciledBy: new Types.ObjectId(
                                          actor.userId,
                                      ),
                                      reconciliationReason: (
                                          dto as ReconcileOfflineSaleDto
                                      ).reason,
                                      lateOffline:
                                          shift.status !== ShiftStatus.OPEN,
                                  }
                                : {}),
                        },
                    ],
                    { session },
                );
                const costs = new Map<string, number>();
                for (const line of lines) {
                    const ref = line.attested.costRef;
                    // Existing queued receipts signed before cost tracking remain unknown.
                    if (ref === undefined) continue;
                    if (!Types.ObjectId.isValid(ref)) throw invalid();
                    const quote = await this.costQuotes
                        .findOne({
                            _id: ref,
                            lease: lease._id,
                            product: line.product,
                            unit: line.attested.unit,
                        })
                        .session(session)
                        .lean();
                    if (!quote) throw invalid();
                    const basis = receiptCost(quote.unitCost);
                    if (basis !== undefined) costs.set(ref, basis);
                }
                await this.details.insertMany(
                    lines.map((line) => ({
                        ...(line.attested.costRef &&
                            costs.has(line.attested.costRef) && {
                                unitCost: costs.get(line.attested.costRef),
                            }),
                        sales: sale._id,
                        product: new Types.ObjectId(line.product),
                        quantity: line.quantity,
                        unitPrice: line.attested.price,
                        unit: line.attested.unit,
                    })),
                    { session },
                );
                await this.ledger?.record(
                    lines.map((line) => ({
                        product: line.product,
                        quantity: -line.quantity,
                    })),
                    {
                        type: StockMovementType.SALE,
                        refModel: StockMovementSource.SALE,
                        refId: String(sale._id),
                        user: actor.userId,
                        occurredAt: soldAt,
                    },
                    session,
                );
                return sale._id;
            }, this.connection);
            const sale = await this.sales.findById(saleId).lean();
            if (!sale)
                throw new InternalError('Recorded offline sale not found');
            const cashier = await this.users.findById(lease.cashier).lean();
            return this.receipts.receiptOf(sale, {
                ...actor,
                userId: String(lease.cashier),
                username: cashier?.name ?? 'Former cashier',
            });
        } catch (error) {
            const committed = await replay();
            if (committed) return committed;
            throw error;
        }
    }
}
