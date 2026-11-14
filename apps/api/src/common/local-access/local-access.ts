import {
    ForbiddenException,
    Injectable,
    MiddlewareConsumer,
    Module,
    NestMiddleware,
    NestModule,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TypedConfigService } from '../typed-config/typed-config.service';
import { isSinglePcEnv } from '../typed-config/app-env';

type LocalAccessCheck = (req: Request) => string | null;

/**
 * The single-pc entry check (#358). The browser reaches the API only
 * through the local HTTPS proxy at FRONTEND_URL (`https://localhost:1443`),
 * which forwards the original Host. So every request must name that host,
 * and a request that carries an Origin must come from that origin. This
 * refuses DNS-rebinding pages (a foreign Host), other local web origins (a
 * foreign Origin) and a direct call to the loopback API port that does not
 * name the proxy's host. Returns the refusal reason, or null.
 */
export function localAccessCheck(frontendUrl: string): LocalAccessCheck {
    const url = new URL(frontendUrl);
    const origin = url.origin;
    const host = url.host.toLowerCase();
    return (req) => {
        if (req.headers.host?.toLowerCase() !== host) {
            return 'Unexpected host.';
        }
        const requestOrigin = req.headers.origin;
        if (requestOrigin !== undefined && requestOrigin !== origin) {
            return 'Unexpected origin.';
        }
        return null;
    };
}

/**
 * Applies `localAccessCheck` in single-pc; a no-op in every other APP_ENV
 * (cloud, dev and test keep CORS and their proxy rules unchanged).
 */
@Injectable()
export class LocalAccessMiddleware implements NestMiddleware {
    private readonly check: LocalAccessCheck | null;

    constructor(config: TypedConfigService) {
        this.check = isSinglePcEnv(config.get('APP_ENV'))
            ? localAccessCheck(config.get('FRONTEND_URL'))
            : null;
    }

    use(req: Request, _res: Response, next: NextFunction): void {
        const refusal = this.check?.(req);
        if (refusal) throw new ForbiddenException(refusal);
        next();
    }
}

/** Applies `LocalAccessMiddleware` to every route, after the request id. */
@Module({})
export class LocalAccessModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(LocalAccessMiddleware).forRoutes('*');
    }
}
