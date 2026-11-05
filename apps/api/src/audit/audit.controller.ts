import { Controller, Get, Query } from '@nestjs/common';
import {
    Role,
    type AuditLogView,
    type Paginated,
} from '@grocery-pos/contracts';
import { Roles } from '../auth/auth.decorator';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './audit.dto';
@Roles(Role.Admin)
@Controller('audit')
export class AuditController {
    constructor(private service: AuditService) {}
    @Get() list(@Query() dto: AuditQueryDto): Promise<Paginated<AuditLogView>> {
        return this.service.list(dto);
    }
}
