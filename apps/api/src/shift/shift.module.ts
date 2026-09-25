import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Sales, SalesSchema } from '../sales/sales.schema';
import { ShiftController } from './shift.controller';
import { Shift, ShiftSchema } from './shift.schema';
import { ShiftService } from './shift.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Shift.name, schema: ShiftSchema },
            // Read at close for the Z-read. SalesModule depends on this
            // module (sales are written into shifts), not the other way.
            { name: Sales.name, schema: SalesSchema },
        ]),
    ],
    providers: [ShiftService],
    exports: [ShiftService],
    controllers: [ShiftController],
})
export class ShiftModule {}
