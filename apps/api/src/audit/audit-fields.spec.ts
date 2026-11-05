import { AuditAction } from '@grocery-pos/contracts';
import { auditFields } from './audit-fields';

describe('business audit field allowlist', () => {
    it('never copies secret fields even when a caller accidentally passes a whole document', () => {
        expect(
            auditFields(AuditAction.USER_CREATED, {
                name: 'staff',
                roles: ['SELLER'],
                isActive: true,
                password: 'secret',
                passwordHash: 'hash',
                overridePinHash: 'pin',
                refreshToken: 'token',
                cookie: 'sid',
                authorization: 'Bearer secret',
                nested: { password: 'hidden' },
            }),
        ).toEqual({ name: 'staff', roles: ['SELLER'], isActive: true });
    });
    it('records only the fact of a credential change', () => {
        expect(
            auditFields(AuditAction.USER_PASSWORD_RESET, {
                passwordChanged: true,
                password: 'secret',
                name: 'unrelated',
            }),
        ).toEqual({ passwordChanged: true });
        expect(
            auditFields(AuditAction.USER_PIN_CHANGED, {
                pinConfigured: false,
                pin: '123456',
            }),
        ).toEqual({ pinConfigured: false });
    });
    it('rejects objects, noninteger money, unbounded role lists and nonstring roles', () => {
        expect(
            auditFields(AuditAction.USER_UPDATED, {
                name: { secret: 'nested' },
                roles: [{ password: 'nested' }],
            }),
        ).toEqual({});
        expect(
            auditFields(AuditAction.USER_UPDATED, {
                roles: Array(101).fill('SELLER'),
            }),
        ).toEqual({});
        expect(
            auditFields(AuditAction.PRODUCT_PRICE_CHANGED, { price: Infinity }),
        ).toEqual({});
        expect(
            auditFields(AuditAction.PRODUCT_PRICE_CHANGED, { price: 1.5 }),
        ).toEqual({});
    });
    it('bounds attacker-controlled strings and preserves zero/false/null', () => {
        expect(
            auditFields(AuditAction.AUTH_LOGIN_FAILED, {
                name: 'x'.repeat(2000),
            }).name,
        ).toHaveLength(1024);
        expect(
            auditFields(AuditAction.USER_UPDATED, {
                roles: ['x'.repeat(200)],
                isActive: false,
                name: null,
            }),
        ).toEqual({ roles: ['x'.repeat(128)], isActive: false, name: null });
        expect(
            auditFields(AuditAction.PRODUCT_PRICE_CHANGED, { price: 0 }),
        ).toEqual({ price: 0 });
    });
});
