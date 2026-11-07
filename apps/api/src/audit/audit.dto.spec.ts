import 'reflect-metadata';
import { AuditAction, STRING_LIMITS } from '@grocery-pos/contracts';
import { AuditQueryDto } from './audit.dto';
import { createValidationPipe } from '../common/pipes/validation.pipe';

const pipe = createValidationPipe();
const query = (value: unknown) =>
    pipe.transform(value, { type: 'query', metatype: AuditQueryDto });
describe('audit query boundaries', () => {
    it('uses bounded pagination defaults', async () => {
        expect(await query({})).toMatchObject({ page: 1, limit: 20 });
    });
    it('allows an exact actor/action and inclusive calendar dates', async () => {
        expect(
            await query({
                username: 'cashier1',
                action: AuditAction.USER_CREATED,
                from: '2026-01-01',
                to: '2026-01-01',
            }),
        ).toMatchObject({ action: AuditAction.USER_CREATED });
    });
    it('trims and lowercases the username as usernames are stored (#143)', async () => {
        expect(await query({ username: '  Cashier1 ' })).toMatchObject({
            username: 'cashier1',
        });
        expect(
            await query({
                username: ` ${'a'.repeat(STRING_LIMITS.USERNAME)} `,
            }),
        ).toMatchObject({ username: 'a'.repeat(STRING_LIMITS.USERNAME) });
        const injected = (await query({ username: { $ne: null } })) as {
            username: unknown;
        };
        expect(typeof injected.username).toBe('string');
    });
    it.each([
        { page: 0 },
        { limit: 101 },
        { page: 1.5 },
        { actor: '507f1f77bcf86cd799439011' },
        { username: 'a'.repeat(STRING_LIMITS.USERNAME + 1) },
        { username: ['admin', 'other'] },
        { action: 'AUTH.SECRET' },
        { from: '2026-02-30' },
        { from: '2026-11-02', to: '2026-11-01' },
        { password: 'never' },
    ])('rejects malformed or extra query fields %p', async (value) => {
        await expect(query(value)).rejects.toThrow();
    });
});
