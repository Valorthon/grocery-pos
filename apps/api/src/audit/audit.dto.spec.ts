import 'reflect-metadata';
import { AuditAction } from '@grocery-pos/contracts';
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
                actor: '507f1f77bcf86cd799439011',
                action: AuditAction.USER_CREATED,
                from: '2026-01-01',
                to: '2026-01-01',
            }),
        ).toMatchObject({ action: AuditAction.USER_CREATED });
    });
    it.each([
        { page: 0 },
        { limit: 101 },
        { page: 1.5 },
        { actor: 'anything' },
        { actor: { $ne: null } },
        { action: 'AUTH.SECRET' },
        { from: '2026-02-30' },
        { from: '2026-11-02', to: '2026-11-01' },
        { password: 'never' },
    ])('rejects malformed or extra query fields %p', async (value) => {
        await expect(query(value)).rejects.toThrow();
    });
});
