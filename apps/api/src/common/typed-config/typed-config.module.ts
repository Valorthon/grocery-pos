import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './validation.env';
import { TypedConfigService } from './typed-config.service';

@Global()
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: (config) =>
                validateEnv(config, (message) =>
                    new Logger('Config').warn(message),
                ),
        }),
    ],
    providers: [TypedConfigService],
    exports: [TypedConfigService],
})
export class TypedConfigModule {}
