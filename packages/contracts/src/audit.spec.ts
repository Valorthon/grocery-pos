import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_LABELS, AuditAction } from './audit.js';
import { ErrorCode } from './errors.js';
import { STEP_UP_TTL_S } from './override.js';

describe('audit labels', () => {
    it('labels every action, the step-up ones included (#310)', () => {
        for (const action of Object.values(AuditAction))
            expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
        expect(AUDIT_ACTION_LABELS[AuditAction.AUTH_REAUTH]).toBe(
            'Password confirmed',
        );
        expect(AUDIT_ACTION_LABELS[AuditAction.AUTH_REAUTH_FAILED]).toBe(
            'Password confirmation failed',
        );
    });
});

describe('step-up (#310)', () => {
    it('lasts five minutes and refuses with a USER_ code', () => {
        expect(STEP_UP_TTL_S).toBe(300);
        expect(ErrorCode.USER_REAUTH_REQUIRED).toBe('USER_008');
    });
});
