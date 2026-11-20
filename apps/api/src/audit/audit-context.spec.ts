import type { Request, Response } from 'express';
import { AuditContextMiddleware, auditMetadata } from './audit-context';

function metadataFor(ip: string | undefined) {
    const req = { ip, get: () => undefined } as unknown as Request;
    let seen: ReturnType<typeof auditMetadata> | undefined;
    new AuditContextMiddleware().use(req, {} as Response, () => {
        seen = auditMetadata();
    });
    return seen;
}

describe('AuditContextMiddleware IP (#395)', () => {
    it('records IPv6 loopback as 127.0.0.1', () => {
        expect(metadataFor('::1')?.ip).toBe('127.0.0.1');
    });

    it('records a LAN terminal address as is', () => {
        expect(metadataFor('192.168.1.20')?.ip).toBe('192.168.1.20');
    });

    it('records null without an address', () => {
        expect(metadataFor(undefined)?.ip).toBeNull();
    });
});
