import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { TypedConfigService } from './common/typed-config/typed-config.service';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { SanitationPipe } from './common/pipes/sanitation.pipe';

async function bootstrap() {
    const logger = new Logger('Bootstrap');

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bufferLogs: true,
    });
    app.use(helmet());

    const config = app.get(TypedConfigService);
    // const isProd = config.get('NODE_ENV') === 'prod';

    app.useGlobalPipes(
        new SanitationPipe(config.get('SANITATION_EXCLUDES')),
        new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
            transformOptions: { enableImplicitConversion: true },
            /* uncomment if frontend relies on api error messages */
            // disableErrorMessages: isProd,
        }),
    );

    app.use(cookieParser(config.get('COOKIE_SECRET')));
    app.enableVersioning({
        defaultVersion: '1',
        type: VersioningType.URI,
    });

    app.enableCors({
        origin: config.get('FRONTEND_URL'),
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    });

    if (config.get('NODE_ENV') === 'prod') {
        app.set('trust proxy', 1);
    }

    app.enableShutdownHooks();

    const port = config.get('PORT') ?? process.env.PORT;
    await app.listen(port, '0.0.0.0');

    logger.log(
        `API running on port: ${port}, in ${config.get('NODE_ENV')} mode`,
    );
}

void bootstrap();
