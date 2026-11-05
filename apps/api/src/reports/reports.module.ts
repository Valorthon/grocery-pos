import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Sales, SalesSchema } from '../sales/sales.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Sales.name, schema: SalesSchema }]),
    ],
    controllers: [ReportsController],
    providers: [ReportsService],
})
export class ReportsModule {}
