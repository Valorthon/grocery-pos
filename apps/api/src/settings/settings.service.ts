import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import {
    SETTINGS_LIMITS,
    type StoreSettings,
    type StoreToday,
} from '@grocery-pos/contracts';
import { calendarDateInZone } from '../common/utils/timezone';
import { Settings } from './settings.schema';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { ConflictError, ErrorCode, InternalError } from '../common/errors';

export function settingsView(row: Settings): StoreSettings {
    return {
        storeName: row.storeName,
        branchName: row.branchName,
        address: row.address,
        contactNumber: row.contactNumber,
        tin: row.tin,
        receiptFooter: row.receiptFooter,
        timezone: row.timezone,
        currency: row.currency,
        defaultReorderLevel: row.defaultReorderLevel,
        expiryAlertDays:
            row.expiryAlertDays ?? SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_DEFAULT,
        version: row.version,
    };
}
/** No process-local business-value cache: every read sees committed store settings. */
@Injectable()
export class SettingsService implements OnModuleInit {
    constructor(
        @InjectModel(Settings.name) private model: Model<Settings>,
        private config: TypedConfigService,
    ) {}
    async onModuleInit(): Promise<void> {
        await this.model.init();
        try {
            await this.model.updateOne(
                { key: 'store' },
                {
                    $setOnInsert: {
                        key: 'store',
                        storeName: 'Grocery POS',
                        branchName: '',
                        address: '',
                        contactNumber: '',
                        tin: '',
                        receiptFooter: 'Thank you for shopping!',
                        timezone: this.config.get('STORE_TIMEZONE'),
                        currency: 'PHP',
                        defaultReorderLevel: 10,
                        expiryAlertDays:
                            SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_DEFAULT,
                        version: 0,
                        contextLock: 0,
                    },
                },
                { upsert: true, runValidators: true },
            );
        } catch (error) {
            if (!(
                error &&
                typeof error === 'object' &&
                'code' in error &&
                error.code === 11000
            ))
                throw error;
        }
    }
    async read(session?: ClientSession): Promise<StoreSettings> {
        const row = await this.model
            .findOne({ key: 'store' })
            .session(session ?? null)
            .lean();
        if (!row)
            throw new InternalError('Store settings have not initialized');
        return settingsView(row);
    }
    /** Today's store-calendar date, for client date presets (#215). */
    async today(now: Date = new Date()): Promise<StoreToday> {
        const timezone = await this.timezone();
        const d = calendarDateInZone(now, timezone);
        const pad = (n: number, w = 2) => String(n).padStart(w, '0');
        return {
            today: `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`,
            timezone,
        };
    }
    async timezone(session?: ClientSession): Promise<string> {
        return (await this.read(session)).timezone;
    }
    /** Shift/lease creation and timezone edits write the same row, so their transactions serialize. */
    async lockContext(session: ClientSession): Promise<StoreSettings> {
        const row = await this.model
            .findOneAndUpdate(
                { key: 'store' },
                { $inc: { contextLock: 1 } },
                { new: true, session },
            )
            .lean();
        if (!row)
            throw new InternalError('Store settings have not initialized');
        return settingsView(row);
    }
    async replace(
        version: number,
        changes: Partial<StoreSettings>,
        session: ClientSession,
    ): Promise<StoreSettings> {
        const row = await this.model
            .findOneAndUpdate(
                { key: 'store', version },
                { $set: changes, $inc: { version: 1 } },
                { new: true, session, runValidators: true },
            )
            .lean();
        if (!row)
            throw new ConflictError(
                ErrorCode.CONFLICT,
                'Store settings changed. Reload before saving.',
            );
        return settingsView(row);
    }
}
