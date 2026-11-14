import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { TypedConfigService } from './common/typed-config/typed-config.service';
import { Logger, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { corsOptions } from './common/cors';
import { applyTrustProxy, listenHost } from './common/http-topology';
import { useBodyParsers } from './common/body-parsers';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { isSinglePcEnv } from './common/typed-config/app-env';
import { awaitDatabaseReady } from './common/startup-readiness';

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

    // prod/stage trust their one cloud proxy hop; single-pc, dev and test
    // trust none (see trustProxySetting, #358).
    applyTrustProxy(app, config.get('APP_ENV'));

    app.enableShutdownHooks();

    // single-pc (#360): no traffic before the local replica set is a
    // writable primary and every index exists. Cloud startup is unchanged.
    if (isSinglePcEnv(config.get('APP_ENV'))) {
        await awaitDatabaseReady(app.get<Connection>(getConnectionToken()));
    }

    const port = config.get('PORT') ?? process.env.PORT;
    // single-pc listens on loopback only (#358); cloud keeps 0.0.0.0.
    const host = listenHost(config.get('APP_ENV'), config.get('HOST'));
    await app.listen(port, host);

    logger.log(
        `API running on ${host}:${port}, APP_ENV=${config.get('APP_ENV')}, NODE_ENV=${process.env.NODE_ENV ?? 'unset'}`,
    );
}

void bootstrap();
