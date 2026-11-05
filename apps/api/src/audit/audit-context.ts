import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AUDIT_LIMITS } from '@grocery-pos/contracts';

export interface AuditMetadata {
    ip: string | null;
    userAgent: string | null;
}
const storage = new AsyncLocalStorage<AuditMetadata>();
export function auditMetadata(): AuditMetadata {
    return storage.getStore() ?? { ip: null, userAgent: null };
}
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
    use(req: Request, _res: Response, next: NextFunction): void {
        storage.run(
            {
                ip: req.ip?.slice(0, AUDIT_LIMITS.IP) ?? null,
                userAgent:
                    req.get('user-agent')?.slice(0, AUDIT_LIMITS.USER_AGENT) ??
                    null,
            },
            next,
        );
    }
}
