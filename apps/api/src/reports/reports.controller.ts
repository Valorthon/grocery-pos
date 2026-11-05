import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { Role } from '../auth/types';
import { Roles } from '../auth/auth.decorator';
import type { ReportOptions, SalesReport } from '@grocery-pos/contracts';
import { ReportsService } from './reports.service';
import { SalesReportQuery } from './reports.dto';
import { salesReportCsv } from './report-csv';

@Roles(Role.Admin)
@Controller('reports')
export class ReportsController {
    constructor(private service: ReportsService) {}
    @Get('options')
    options(): ReportOptions {
        return this.service.options();
    }
    @Get('sales')
    sales(@Query() dto: SalesReportQuery): Promise<SalesReport> {
        return this.service.salesReport(dto);
    }
    @Get('sales.csv')
    async csv(@Query() dto: SalesReportQuery): Promise<StreamableFile> {
        const report = await this.service.salesReport(dto);
        return new StreamableFile(Readable.from(salesReportCsv(report)), {
            type: 'text/csv; charset=utf-8',
            disposition: `attachment; filename="sales-${dto.from}-${dto.to}-${dto.groupBy}.csv"`,
        });
    }
}
