import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './validation.env';
import { TypedConfigService } from './typed-config.service';

@Global()
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: (config) => {
                const parsed = envSchema.safeParse(config);

                if (!parsed.success) {
                    throw new Error(
                        'Invalid env variable: ' +
                            JSON.stringify(parsed.error.issues, null, 2),
                    );
                }

                return parsed.data;
            },
        }),
    ],
    providers: [TypedConfigService],
    exports: [TypedConfigService],
})
export class TypedConfigModule {}
