import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { TypedConfigService } from './common/typed-config/typed-config.service';
import { Logger, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { createValidationPipe } from './common/pipes/validation.pipe';

async function bootstrap() {
    const logger = new Logger('Bootstrap');

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bufferLogs: true,
    });
    app.use(helmet());

    const config = app.get(TypedConfigService);

    // Validation only: request text is stored as typed, trimmed per field by
    // the DTOs (see createValidationPipe, issue #15).
    app.useGlobalPipes(createValidationPipe());

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

    // Deployed (prod/stage on Railway), the API sits behind exactly one
    // reverse proxy, which appends the real client address to
    // X-Forwarded-For. Trusting that one hop makes `req.ip` the client, which
    // the login/refresh rate limits key on. Trusting more hops (or `true`)
    // would let a client pick its own IP by sending X-Forwarded-For; trusting
    // none would put every client in the proxy's single rate-limit bucket.
    // Locally (dev/test) there is no proxy, so the header is ignored.
    const nodeEnv = config.get('NODE_ENV');
    if (nodeEnv === 'prod' || nodeEnv === 'stage') {
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
