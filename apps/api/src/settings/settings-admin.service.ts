import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import {
    AuditAction,
    ShiftStatus,
    type AuthUser,
    type StoreSettings,
} from '@grocery-pos/contracts';
import { Shift } from '../shift/shift.schema';
import { OfflineLease } from '../offline/offline-lease.schema';
import { AuditService } from '../audit/audit.service';
import { ConflictError, ErrorCode } from '../common/errors';
import { runInTransaction } from '../common/utils/db';
import { UpdateSettingsDto } from './settings.dto';
import { SettingsService } from './settings.service';

@Injectable()
export class SettingsAdminService {
    constructor(
        @InjectConnection() private connection: Connection,
        private settings: SettingsService,
        @InjectModel(Shift.name) private shifts: Model<Shift>,
        @InjectModel(OfflineLease.name) private leases: Model<OfflineLease>,
        private audit: AuditService,
    ) {}
    async update(
        actor: AuthUser,
        dto: UpdateSettingsDto,
    ): Promise<StoreSettings> {
        return runInTransaction(async (session) => {
            const before = await this.settings.lockContext(session);
            if (before.version !== dto.version)
                throw new ConflictError(
                    ErrorCode.CONFLICT,
                    'Store settings changed. Reload before saving.',
                );
            if (
                dto.timezone !== undefined &&
                dto.timezone !== before.timezone
            ) {
                if (
                    (await this.shifts
                        .exists({ status: ShiftStatus.OPEN })
                        .session(session)) ||
                    (await this.leases
                        .exists({ active: true })
                        .session(session))
                )
                    throw new ConflictError(
                        ErrorCode.CONFLICT,
                        'Close open shifts and release every active offline lease before changing the store timezone.',
                    );
            }
            const { version: _version, ...changes } = dto;
            void _version;
            const after = await this.settings.replace(
                dto.version,
                changes,
                session,
            );
            await this.audit.record(
                {
                    actor,
                    action: AuditAction.SETTINGS_UPDATED,
                    targetModel: 'Settings',
                    before: { ...before },
                    after: { ...after },
                },
                session,
            );
            return after;
        }, this.connection);
    }
}
