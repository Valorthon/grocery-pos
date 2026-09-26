import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { text } from 'body-parser';
import { RateLimitModule } from '../auth/rate-limit/rate-limit';
import { CSP_REPORT_CONTENT_TYPES, CSP_REPORT_MAX_BYTES } from './csp-report';
import { CspReportController } from './csp-report.controller';

/**
 * CSP violation reports (#94). The app's global body parsers (Nest's
 * defaults: JSON and urlencoded) do not match the report media types, so
 * this module adds a text parser for exactly those two types on exactly
 * this controller's route, capped at `CSP_REPORT_MAX_BYTES` (a larger
 * body is a 413 before the handler runs). Global parsing is unchanged.
 */
@Module({
    imports: [RateLimitModule],
    controllers: [CspReportController],
})
export class CspReportModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer
            .apply(
                text({
                    type: [...CSP_REPORT_CONTENT_TYPES],
                    limit: CSP_REPORT_MAX_BYTES,
                }),
            )
            .forRoutes(CspReportController);
    }
}
