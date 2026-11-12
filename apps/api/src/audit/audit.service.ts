import { SettingsService } from '../settings/settings.service';
import {
    Inject as InjectSettings,
    Optional as OptionalSettings,
} from '@nestjs/common';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
    AuditAction,
    purchaseOrderReference,
    type AuditLogView,
    type AuthUser,
    type Paginated,
} from '@grocery-pos/contracts';
import { AuditLog } from './audit.schema';
import { User } from '../user/user.schema';
import { auditFields } from './audit-fields';
import { auditMetadata } from './audit-context';
import { AuditQueryDto } from './audit.dto';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { dateRangeFilter } from '../common/utils/timezone';

export interface AuditEvent {
    actor: Pick<AuthUser, 'userId' | 'username'> | null;
    action: AuditAction;
    targetModel: string;
    targetId?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    approvedBy?: string;
}
@Injectable()
export class AuditService implements OnModuleInit {
    constructor(
        @InjectModel(AuditLog.name) private model: Model<AuditLog>,
        private config: TypedConfigService,
        @InjectModel(User.name) private users: Model<User>,
        @OptionalSettings()
        @InjectSettings(SettingsService)
        private settings?: SettingsService,
        @OptionalSettings()
        @InjectConnection()
        private connection?: Connection,
    ) {}
    async onModuleInit(): Promise<void> {
        await this.model.init();
    }
    async record(event: AuditEvent, session?: ClientSession): Promise<void> {
        await this.model.create(
            [
                {
                    actor: event.actor
                        ? new Types.ObjectId(event.actor.userId)
                        : null,
                    actorName: event.actor?.username ?? null,
                    action: event.action,
                    targetModel: event.targetModel,
                    targetId: event.targetId
                        ? new Types.ObjectId(event.targetId)
                        : null,
                    before: auditFields(event.action, event.before ?? {}),
                    after: auditFields(event.action, event.after ?? {}),
                    approvedBy: event.approvedBy
                        ? new Types.ObjectId(event.approvedBy)
                        : null,
                    ...auditMetadata(),
                },
            ],
            session ? { session } : {},
        );
    }
    async list(dto: AuditQueryDto): Promise<Paginated<AuditLogView>> {
        const filter: Record<string, unknown> = {};
        if (dto.username) {
            // The current holder of the name, by id, so entries recorded
            // under an earlier name still match; plus failed logins typed
            // with this name (stored trimmed and lowercased, actor null),
            // which an unknown name still finds (#143).
            const user = await this.users
                .findOne({ name: dto.username }, { _id: 1 })
                .lean<{ _id: Types.ObjectId }>();
            const failed = {
                action: AuditAction.AUTH_LOGIN_FAILED,
                'after.name': dto.username,
            };
            filter.$or = user ? [{ actor: user._id }, failed] : [failed];
        }
        if (dto.action) filter.action = dto.action;
        const timeZone = this.settings
            ? await this.settings.timezone()
            : this.config.get('STORE_TIMEZONE');
        const range = dateRangeFilter(dto.from, dto.to, timeZone);
        if (range) filter.createdAt = range;
        const [rows, totalItems] = await Promise.all([
            this.model
                .find(filter)
                .sort({ createdAt: -1, _id: -1 })
                .skip((dto.page - 1) * dto.limit)
                .limit(dto.limit)
                .lean(),
            this.model.countDocuments(filter),
        ]);
        const labels = await this.labels(rows, timeZone);
        return {
            totalItems,
            data: rows.map((row) => ({
                _id: String(row._id),
                actor: row.actor
                    ? { _id: String(row.actor), name: row.actorName ?? '' }
                    : null,
                action: row.action,
                target: {
                    model: row.targetModel,
                    id: row.targetId ? String(row.targetId) : null,
                    ...optional(
                        'label',
                        row.targetId
                            ? labels.get(
                                  `${row.targetModel}:${String(row.targetId)}`,
                              )
                            : row.targetModel === 'Settings'
                              ? 'Store settings'
                              : undefined,
                    ),
                },
                before: auditFields(row.action, row.before ?? {}),
                after: auditFields(row.action, row.after ?? {}),
                approvedBy: row.approvedBy ? String(row.approvedBy) : null,
                ...optional(
                    'approvedByName',
                    row.approvedBy
                        ? labels.get(`User:${String(row.approvedBy)}`)
                        : undefined,
                ),
                ip: row.ip,
                userAgent: row.userAgent,
                createdAt: new Date(row.createdAt).toISOString(),
            })),
        };
    }

    /**
     * Current names of the page's targets and approvers (#306), keyed
     * `Model:id`: one `$in` query per model, none per row. Stored entries
     * are never touched; a missing reference has no label.
     */
    private async labels(
        rows: {
            targetModel: string;
            targetId?: Types.ObjectId | null;
            approvedBy?: Types.ObjectId | null;
        }[],
        timeZone: string,
    ): Promise<Map<string, string>> {
        const ids = new Map<string, Set<string>>();
        const add = (model: string, id?: Types.ObjectId | null) => {
            if (!id) return;
            const set = ids.get(model) ?? new Set<string>();
            set.add(String(id));
            ids.set(model, set);
        };
        for (const row of rows) {
            add(row.targetModel, row.targetId);
            add('User', row.approvedBy);
        }
        const labels = new Map<string, string>();
        const date = new Intl.DateTimeFormat('en-US', {
            timeZone,
            dateStyle: 'medium',
        });
        const lookups: Record<
            string,
            { fields: string; label: (doc: Record<string, unknown>) => string }
        > = {
            User: { fields: 'name', label: (doc) => String(doc.name) },
            Product: { fields: 'name', label: (doc) => String(doc.name) },
            PurchaseOrder: {
                fields: '_id',
                label: (doc) => purchaseOrderReference(String(doc._id)),
            },
            Sales: {
                fields: '_id',
                label: (doc) => String(doc._id).slice(-8).toUpperCase(),
            },
            Shift: {
                fields: 'cashierName openedAt',
                label: (doc) =>
                    `${String(doc.cashierName)} · ${date.format(new Date(doc.openedAt as Date))}`,
            },
        };
        await Promise.all(
            [...ids].map(async ([name, set]) => {
                const lookup = lookups[name];
                const model: Model<unknown> | undefined =
                    name === 'User'
                        ? (this.users as unknown as Model<unknown>)
                        : this.connection?.models[name];
                if (!lookup || !model) return;
                const docs = (await model
                    .find(
                        {
                            _id: {
                                $in: [...set].map(
                                    (id) => new Types.ObjectId(id),
                                ),
                            },
                        },
                        lookup.fields,
                    )
                    .lean()) as unknown as Record<string, unknown>[];
                for (const doc of docs)
                    labels.set(`${name}:${String(doc._id)}`, lookup.label(doc));
            }),
        );
        return labels;
    }
}

/** `{ [key]: value }` when the value is set, else nothing. */
function optional<K extends string>(
    key: K,
    value: string | undefined,
): Partial<Record<K, string>> {
    return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}
