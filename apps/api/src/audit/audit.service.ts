import { SettingsService } from '../settings/settings.service';
import {
    Inject as InjectSettings,
    Optional as OptionalSettings,
} from '@nestjs/common';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
    AuditAction,
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
            // The current holder of the name, by id: entries recorded under
            // an earlier name still match, and an unknown name matches none.
            const user = await this.users
                .findOne({ name: dto.username }, { _id: 1 })
                .lean<{ _id: Types.ObjectId }>();
            if (!user) return { totalItems: 0, data: [] };
            filter.actor = user._id;
        }
        if (dto.action) filter.action = dto.action;
        const range = dateRangeFilter(
            dto.from,
            dto.to,
            this.settings
                ? await this.settings.timezone()
                : this.config.get('STORE_TIMEZONE'),
        );
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
                },
                before: auditFields(row.action, row.before ?? {}),
                after: auditFields(row.action, row.after ?? {}),
                approvedBy: row.approvedBy ? String(row.approvedBy) : null,
                ip: row.ip,
                userAgent: row.userAgent,
                createdAt: new Date(row.createdAt).toISOString(),
            })),
        };
    }
}
