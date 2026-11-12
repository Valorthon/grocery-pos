import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@grocery-pos/contracts';
import { StockCountStatus } from '@grocery-pos/contracts';
import { StockCount } from '../../stock-count/stock-count.schema';
import { stockCountContext } from '../../stock-count/stock-count.context';
import {
    quantityAmount,
    maxQuantityForAmount,
    NUMERIC_LIMITS,
    type UnitOfMeasure,
} from '@grocery-pos/contracts';
import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon from 'argon2';
import {
    discountAmount,
    OverrideAction,
    OVERRIDE_APPROVAL_TTL_S,
    Role,
    SaleStatus,
    saleNetCash,
    ShiftStatus,
    type AuthUser,
    type ManagerOverrideResponse,
} from '@grocery-pos/contracts';
import { OverrideGrant } from './override-grant.schema';
import { User } from '../../user/user.schema';
import { Sales, type SaleDoc } from '../../sales/sales.schema';
import { Shift } from '../../shift/shift.schema';
import { ProductService } from '../../product/product.service';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import {
    ConflictError,
    ErrorCode,
    ForbiddenError,
    NotFoundError,
    ValidationError,
} from '../../common/errors';
import { runInTransaction } from '../../common/utils/db';
import { StepUpService } from '../step-up/step-up.service';
import { saleRequestHash } from '../../sales/idempotency';
import {
    discountApprovalContext,
    reversalApprovalContext,
} from './override-context';
import { ManagerOverrideDto, SetOverridePinDto } from './override.dto';
import type { SellDto } from '../../sales/types/sales.dto';

const AUDIENCE = 'grocery-pos-manager-override';
const invalidApproval = () =>
    new ForbiddenError(
        ErrorCode.OVERRIDE_INVALID,
        'Manager approval expired, changed or was already used. Request approval again.',
    );
const invalidCredentials = () =>
    new ForbiddenError(
        ErrorCode.OVERRIDE_CREDENTIALS_INVALID,
        'Invalid manager username or PIN',
    );

@Injectable()
export class ManagerOverrideService implements OnModuleInit {
    private dummyHash?: Promise<string>;
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(OverrideGrant.name) private grants: Model<OverrideGrant>,
        @InjectModel(User.name) private users: Model<User>,
        @InjectModel(Sales.name) private sales: Model<Sales>,
        @InjectModel(Shift.name) private shifts: Model<Shift>,
        private products: ProductService,
        private jwt: JwtService,
        private config: TypedConfigService,
        @Optional()
        @InjectModel(StockCount.name)
        private stockCounts: Model<StockCount> | undefined = undefined,
        private audit: AuditService,
        private stepUp: StepUpService,
    ) {}

    onModuleInit(): void {
        void this.dummy();
    }
    private dummy(): Promise<string> {
        this.dummyHash ??= argon.hash(randomBytes(32).toString('base64'));
        return this.dummyHash;
    }

    requiresDiscountApproval(amount: number): boolean {
        return amount > 0;
    }

    async setPin(
        actor: AuthUser,
        targetId: string,
        dto: SetOverridePinDto,
    ): Promise<void> {
        // Hash outside the transaction; every retry then uses the same new version.
        const hash = dto.pin === null ? null : await argon.hash(dto.pin);
        const version = randomUUID();
        await runInTransaction(async (session) => {
            const admin = await this.users
                .findOne({
                    _id: actor.userId,
                    isActive: true,
                    roles: Role.Admin,
                })
                .session(session)
                .lean();
            if (!admin)
                throw new ForbiddenError(
                    ErrorCode.FORBIDDEN,
                    'Only an active admin can manage manager PINs',
                );
            // Setting, resetting or removing a PIN needs a step-up (#310).
            await this.stepUp.assertLive(actor, session);
            const target = await this.users
                .findById(targetId)
                .session(session)
                .lean();
            if (!target)
                throw new NotFoundError(ErrorCode.NOT_FOUND, 'User not found');
            if (
                !target.roles.some(
                    (role) => role === Role.Admin || role === Role.Supervisor,
                )
            ) {
                throw new ValidationError(
                    ErrorCode.VALIDATION_INVALID_INPUT,
                    'Only admins and supervisors can hold a manager PIN',
                );
            }
            // Lock the admin too, so concurrent demotion cannot leave stale power.
            await this.users.updateOne(
                { _id: actor.userId },
                { $inc: { overrideApprovalLock: 1 } },
                { session },
            );
            await this.users.updateOne(
                { _id: targetId },
                hash === null
                    ? {
                          $unset: { overridePinHash: 1 },
                          $set: { overridePinVersion: version },
                      }
                    : {
                          $set: {
                              overridePinHash: hash,
                              overridePinVersion: version,
                          },
                      },
                { session },
            );
            await this.audit.record(
                {
                    actor,
                    action: AuditAction.USER_PIN_CHANGED,
                    targetModel: 'User',
                    targetId,
                    after: { pinConfigured: hash !== null },
                },
                session,
            );
        }, this.connection);
    }

    async issue(
        actor: AuthUser,
        dto: ManagerOverrideDto,
    ): Promise<ManagerOverrideResponse> {
        const manager = await this.users
            .findOne({ name: dto.username })
            .select('+overridePinHash +overridePinVersion')
            .lean();
        const valid = await argon.verify(
            manager?.overridePinHash ?? (await this.dummy()),
            dto.pin,
        );
        if (
            !valid ||
            !manager?.isActive ||
            !manager.overridePinVersion ||
            !manager.roles.some(
                (r) =>
                    r === Role.Admin ||
                    (dto.action !== OverrideAction.DISCOUNT &&
                        r === Role.Supervisor),
            )
        )
            throw invalidCredentials();
        if (!actor.sid)
            throw new ForbiddenError(
                ErrorCode.FORBIDDEN,
                'Log in again before requesting manager approval',
            );
        const requester = await this.users
            .findOne({
                _id: actor.userId,
                isActive: true,
                roles:
                    dto.action === OverrideAction.STOCK_COUNT
                        ? { $in: [Role.Adjuster, Role.Admin] }
                        : dto.action === OverrideAction.DISCOUNT ||
                            !actor.roles.includes(Role.Admin)
                          ? Role.Seller
                          : Role.Admin,
            })
            .select('+overridePinVersion')
            .lean();
        if (!requester)
            throw new ForbiddenError(
                ErrorCode.FORBIDDEN,
                'Your account can no longer request manager approval',
            );
        const contextHash = await this.resolveContext(actor, dto);
        const expiresAt = new Date(Date.now() + OVERRIDE_APPROVAL_TTL_S * 1000);
        const [grant] = await this.grants.create([
            {
                cashier: actor.userId,
                sessionId: actor.sid,
                requesterVersion: requester.overridePinVersion ?? null,
                approver: manager._id,
                approverPinVersion: manager.overridePinVersion,
                action: dto.action,
                contextHash,
                expiresAt,
            },
        ]);
        const token = this.jwt.sign(
            { grantId: String(grant._id) },
            {
                secret: this.config.get('JWT_SECRET'),
                audience: AUDIENCE,
                expiresIn: OVERRIDE_APPROVAL_TTL_S,
            },
        );
        return {
            token,
            expiresAt: expiresAt.toISOString(),
            approver: { _id: String(manager._id), name: manager.name },
        };
    }

    private async resolveContext(
        actor: AuthUser,
        dto: ManagerOverrideDto,
    ): Promise<string> {
        const { context, action } = dto;
        if (action === OverrideAction.STOCK_COUNT) {
            if (
                !context.stockCount ||
                context.sale ||
                context.reversal ||
                context.expectedSubtotal !== undefined ||
                !actor.roles.some(
                    (role) => role === Role.Adjuster || role === Role.Admin,
                )
            )
                throw new ValidationError(
                    ErrorCode.VALIDATION_INVALID_INPUT,
                    'A stock count approval requires the submitted count and version',
                );
            const count = await this.stockCounts
                ?.findById(context.stockCount.countId)
                .lean();
            if (
                !count ||
                count.status !== StockCountStatus.SUBMITTED ||
                count.version !== context.stockCount.version
            )
                throw new ConflictError(
                    ErrorCode.CONFLICT,
                    'Stock count changed. Reload it before requesting approval',
                );
            return stockCountContext(count);
        }
        if (action === OverrideAction.DISCOUNT) {
            if (
                !actor.roles.includes(Role.Seller) ||
                !context.sale ||
                context.reversal ||
                context.expectedSubtotal === undefined ||
                !context.sale.discount
            ) {
                throw new ValidationError(
                    ErrorCode.VALIDATION_INVALID_INPUT,
                    'A discount approval requires the checkout and displayed subtotal',
                );
            }
            const dto = context.sale;
            const products = await this.products.getMany(
                dto.sellDetails.map((l) => l.product),
            );
            const lines = dto.sellDetails.map(({ product, quantity }) => {
                const found = products.get(product);
                if (!found)
                    throw new ValidationError(
                        ErrorCode.VALIDATION_INVALID_INPUT,
                        'Unknown product',
                    );
                if (
                    quantity >
                    maxQuantityForAmount(
                        NUMERIC_LIMITS.AMOUNT_MAX,
                        found.price,
                        found.unit,
                    )
                )
                    throw new ValidationError(
                        ErrorCode.VALIDATION_INVALID_INPUT,
                        'Sale exceeds the maximum amount',
                    );
                return {
                    product,
                    quantity,
                    unitPrice: found.price,
                    ...(found.unit && { unit: found.unit }),
                };
            });
            const subtotal = lines.reduce(
                (sum, l) =>
                    sum + quantityAmount(l.unitPrice, l.quantity, l.unit),
                0,
            );
            if (subtotal !== context.expectedSubtotal)
                throw new ConflictError(
                    ErrorCode.CONFLICT,
                    'Prices changed. Review the current total and request approval again.',
                );
            const amount = discountAmount(subtotal, dto.discount!);
            if (amount <= 0 || amount >= subtotal)
                throw new ValidationError(
                    ErrorCode.VALIDATION_INVALID_INPUT,
                    'Invalid discount amount',
                );
            return this.discountContext(actor, dto, lines);
        }
        if (
            !context.reversal ||
            context.sale ||
            context.expectedSubtotal !== undefined
        ) {
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'A reversal approval requires its sale and reason',
            );
        }
        const { saleId, reason, payoutShiftId } = context.reversal;
        const sale = await this.visibleReversalSale(actor, saleId);
        if (sale.status !== SaleStatus.COMPLETED)
            throw new ConflictError(
                ErrorCode.SALE_NOT_REVERSIBLE,
                'Only a completed sale can be voided or refunded',
            );
        if (!actor.roles.includes(Role.Admin) && payoutShiftId)
            throw new ForbiddenError(
                ErrorCode.FORBIDDEN,
                "A cashier may pay only from the sale's own open shift",
            );
        return this.reversalContext(action, sale, reason, payoutShiftId);
    }

    discountContext(
        actor: AuthUser,
        dto: SellDto,
        lines: readonly {
            product: string;
            quantity: number;
            unitPrice: number;
            unit?: UnitOfMeasure;
        }[],
    ): string {
        return discountApprovalContext(
            dto.idempotencyKey,
            saleRequestHash(actor.userId, dto),
            lines,
        );
    }

    reversalContext(
        action: OverrideAction.VOID | OverrideAction.REFUND,
        sale: SaleDoc,
        reason: string,
        payoutShiftId?: string,
    ): string {
        return reversalApprovalContext({
            action,
            saleId: String(sale._id),
            reason,
            payoutShiftId: payoutShiftId ?? null,
            saleShiftId: sale.shift ? String(sale.shift) : null,
            amount: sale.amount,
            netCash: saleNetCash(sale),
        });
    }

    async visibleReversalSale(
        actor: AuthUser,
        saleId: string,
        session?: ClientSession,
    ): Promise<SaleDoc> {
        const currentActor = await this.users
            .findOne({
                _id: actor.userId,
                isActive: true,
                roles: actor.roles.includes(Role.Admin)
                    ? Role.Admin
                    : Role.Seller,
            })
            .session(session ?? null)
            .lean();
        if (!currentActor)
            throw new ForbiddenError(
                ErrorCode.FORBIDDEN,
                'Your account can no longer reverse sales',
            );
        const filter: Record<string, unknown> = { _id: saleId };
        if (!actor.roles.includes(Role.Admin)) {
            const shift = await this.shifts
                .findOne({ cashier: actor.userId, status: ShiftStatus.OPEN })
                .session(session ?? null)
                .lean();
            if (!shift)
                throw new NotFoundError(ErrorCode.NOT_FOUND, 'Sale not found');
            filter.cashier = new Types.ObjectId(actor.userId);
            filter.shift = shift._id;
        }
        const sale = await this.sales
            .findOne(filter)
            .session(session ?? null)
            .lean<SaleDoc>();
        if (!sale)
            throw new NotFoundError(ErrorCode.NOT_FOUND, 'Sale not found');
        return sale;
    }

    async consume(
        token: string | undefined,
        actor: AuthUser,
        action: OverrideAction,
        contextHash: string,
        session: ClientSession,
    ): Promise<string> {
        if (!token)
            throw new ForbiddenError(
                ErrorCode.OVERRIDE_REQUIRED,
                'Manager approval is required',
            );
        let grantId: string;
        try {
            const payload = this.jwt.verify<{ grantId?: unknown }>(token, {
                secret: this.config.get('JWT_SECRET'),
                audience: AUDIENCE,
                algorithms: ['HS256'],
            });
            if (
                typeof payload.grantId !== 'string' ||
                !Types.ObjectId.isValid(payload.grantId)
            )
                throw invalidApproval();
            grantId = payload.grantId;
        } catch {
            throw invalidApproval();
        }
        const grant = await this.grants
            .findOneAndUpdate(
                {
                    _id: grantId,
                    cashier: new Types.ObjectId(actor.userId),
                    sessionId: actor.sid ?? '',
                    action,
                    contextHash,
                    consumedAt: null,
                    expiresAt: { $gt: new Date() },
                },
                { $set: { consumedAt: new Date() } },
                { session, new: true },
            )
            .lean();
        if (!grant) throw invalidApproval();
        const manager = await this.users.updateOne(
            {
                _id: grant.approver,
                isActive: true,
                roles: {
                    $in:
                        action === OverrideAction.DISCOUNT
                            ? [Role.Admin]
                            : [Role.Admin, Role.Supervisor],
                },
                overridePinVersion: grant.approverPinVersion,
                overridePinHash: { $type: 'string' },
            },
            { $inc: { overrideApprovalLock: 1 } },
            { session },
        );
        if (!manager.matchedCount) throw invalidApproval();
        // The requester's account is also checked at the monetary operation,
        // so an old signed access token cannot bypass a deactivation.
        const requester = await this.users.updateOne(
            {
                _id: actor.userId,
                isActive: true,
                overridePinVersion: grant.requesterVersion ?? null,
                roles: {
                    $in:
                        action === OverrideAction.STOCK_COUNT
                            ? [Role.Adjuster, Role.Admin]
                            : action === OverrideAction.DISCOUNT ||
                                !actor.roles.includes(Role.Admin)
                              ? [Role.Seller]
                              : [Role.Admin],
                },
            },
            { $inc: { overrideApprovalLock: 1 } },
            { session },
        );
        if (!requester.matchedCount) throw invalidApproval();
        return String(grant.approver);
    }
}
