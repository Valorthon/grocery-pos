import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { TypedConfigService } from './common/typed-config/typed-config.service';
import { Logger, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { corsOptions } from './common/cors';
import { listenHost, trustProxySetting } from './common/http-topology';
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

    // prod/stage trust their one cloud proxy hop, single-pc its loopback
    // proxy, dev/test nothing (see trustProxySetting, #358).
    const trustProxy = trustProxySetting(config.get('APP_ENV'));
    if (trustProxy !== undefined) {
        app.set('trust proxy', trustProxy);
    }

    app.enableShutdownHooks();

    const port = config.get('PORT') ?? process.env.PORT;
    // single-pc listens on loopback only (#358); cloud keeps 0.0.0.0.
    const host = listenHost(config.get('APP_ENV'), config.get('HOST'));
    await app.listen(port, host);

    logger.log(
        `API running on ${host}:${port}, APP_ENV=${config.get('APP_ENV')}, NODE_ENV=${process.env.NODE_ENV ?? 'unset'}`,
    );
}

void bootstrap();
