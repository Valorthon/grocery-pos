import { Controller, Get } from '@nestjs/common';
import {
    DiskHealthIndicator,
    HealthCheck,
    HealthCheckService,
    MemoryHealthIndicator,
    MongooseHealthIndicator,
} from '@nestjs/terminus';
import { TypedConfigService } from '../common/typed-config/typed-config.service';

@Controller('health')
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly db: MongooseHealthIndicator,
        private readonly disk: DiskHealthIndicator,
        private readonly memory: MemoryHealthIndicator,
        private readonly config: TypedConfigService,
    ) {}

    @Get('live')
    @HealthCheck()
    checkLiveness() {
        return this.health.check([
            () =>
                this.memory.checkHeap(
                    'memory_heap',
                    this.config.get('HEALTH_HEAP_THRESHOLD'),
                ),
            () =>
                this.memory.checkRSS(
                    'memory_rss',
                    this.config.get('HEALTH_RSS_THRESHOLD'),
                ),
            () =>
                this.disk.checkStorage('storage', {
                    path: this.config.get('HEALTH_DISK_PATH'),
                    threshold: this.config.get('HEALTH_DISK_THRESHOLD'),
                }),
        ]);
    }

    @Get('ready')
    @HealthCheck()
    checkReadiness() {
        return this.health.check([
            () => this.db.pingCheck('mongodb', { timeout: 1500 }),
        ]);
    }
}
