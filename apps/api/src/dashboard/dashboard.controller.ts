import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../auth/auth.decorator';

@Controller('dashboard')
export class DashboardController {
    constructor(private service: DashboardService) {}

    @Roles()
    @Get()
    async getDashboard() {
        return await this.service.getDashboard();
    }
}
