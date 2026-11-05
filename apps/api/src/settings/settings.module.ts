import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Settings, SettingsSchema } from './settings.schema';
import { Shift, ShiftSchema } from '../shift/shift.schema';
import {
    OfflineLease,
    OfflineLeaseSchema,
} from '../offline/offline-lease.schema';
import { SettingsService } from './settings.service';
import { SettingsAdminService } from './settings-admin.service';
import { SettingsController } from './settings.controller';
@Global()
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Settings.name, schema: SettingsSchema },
            { name: Shift.name, schema: ShiftSchema },
            { name: OfflineLease.name, schema: OfflineLeaseSchema },
        ]),
    ],
    providers: [SettingsService, SettingsAdminService],
    exports: [SettingsService],
    controllers: [SettingsController],
})
export class SettingsModule {}
