import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './audit.schema';
import { User, UserSchema } from '../user/user.schema';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditContextMiddleware } from './audit-context';
@Global()
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: AuditLog.name, schema: AuditLogSchema },
            { name: User.name, schema: UserSchema },
        ]),
    ],
    providers: [AuditService],
    exports: [AuditService],
    controllers: [AuditController],
})
export class AuditModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(AuditContextMiddleware).forRoutes('*');
    }
}
