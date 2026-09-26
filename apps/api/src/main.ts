import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { TypedConfigService } from './common/typed-config/typed-config.service';
import { Logger, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { corsOptions } from './common/cors';
import { isDeployedEnv } from './common/typed-config/app-env';
import { useBodyParsers } from './common/body-parsers';

async function bootstrap() {
    const logger = new Logger('Bootstrap');

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bufferLogs: true,
        // Installed below by useBodyParsers, so a parser's error never
        // carries the request's headers or body into a response or log.
        bodyParser: false,
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

    app.enableCors(corsOptions(config.get('FRONTEND_URL')));
    // After CORS, where Nest puts its own parsers: a refused body still
    // gets the CORS headers, so the client can read the error.
    useBodyParsers(app);

    // Deployed (APP_ENV prod/stage on Railway), the API sits behind exactly one
    // reverse proxy, which appends the real client address to
    // X-Forwarded-For. Trusting that one hop makes `req.ip` the client, which
    // the login/refresh rate limits key on. Trusting more hops (or `true`)
    // would let a client pick its own IP by sending X-Forwarded-For; trusting
    // none would put every client in the proxy's single rate-limit bucket.
    // Locally (dev/test) there is no proxy, so the header is ignored.
    if (isDeployedEnv(config.get('APP_ENV'))) {
        app.set('trust proxy', 1);
    }

    app.enableShutdownHooks();

    const port = config.get('PORT') ?? process.env.PORT;
    await app.listen(port, '0.0.0.0');

    logger.log(
        `API running on port: ${port}, APP_ENV=${config.get('APP_ENV')}, NODE_ENV=${process.env.NODE_ENV ?? 'unset'}`,
    );
}

void bootstrap();
