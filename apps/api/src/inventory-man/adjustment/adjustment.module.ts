import { Module } from '@nestjs/common';
import { AdjustmentController } from './adjustment.controller';
import { AdjustmentService } from './adjustment.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Adjustment, AdjustmentSchema } from './adjustment.schema';
import {
    AdjustmentDetails,
    AdjustmentDetailsSchema,
} from './adjustment-details.schema';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: Adjustment.name,
                schema: AdjustmentSchema,
            },
        ]),
        MongooseModule.forFeature([
            {
                name: AdjustmentDetails.name,
                schema: AdjustmentDetailsSchema,
            },
        ]),
        InventoryModule,
    ],
    controllers: [AdjustmentController],
    providers: [AdjustmentService],
})
export class AdjustmentModule {}
