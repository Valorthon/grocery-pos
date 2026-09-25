import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { STRING_LIMITS } from '../../constants';
import { LoginDto } from '../../auth/types';
import { Role } from '../../auth/types';
import { ChangePasswordDto, CreateBulkDto, UpdateBulkDto } from './user.dto';

const SHORT = 'x'.repeat(STRING_LIMITS.PASSWORD_MIN - 1);
const ENOUGH = 'x'.repeat(STRING_LIMITS.PASSWORD_MIN);

function errorsOf(cls: new () => object, plain: object): string[] {
    const errors = validateSync(plainToInstance(cls, plain));
    const flat = (e: (typeof errors)[number]): string[] => [
        ...Object.values(e.constraints ?? {}),
        ...(e.children ?? []).flatMap(flat),
    ];
    return errors.flatMap(flat);
}

describe(`password policy (min ${STRING_LIMITS.PASSWORD_MIN}, #12)`, () => {
    it('is 8 characters', () => {
        expect(STRING_LIMITS.PASSWORD_MIN).toBe(8);
    });

    it('applies to a new user', () => {
        const create = (password: string) => ({
            users: [{ name: 'till', password, roles: [Role.Seller] }],
        });

        expect(errorsOf(CreateBulkDto, create(SHORT))).toEqual([
            expect.stringMatching(/password/),
        ]);
        expect(errorsOf(CreateBulkDto, create(ENOUGH))).toEqual([]);
    });

    it('applies to an admin reset', () => {
        const reset = (password: string) => ({
            updates: [
                { user: '64b7f0c2a1b2c3d4e5f60718', update: { password } },
            ],
        });

        expect(errorsOf(UpdateBulkDto, reset(SHORT))).not.toEqual([]);
        expect(errorsOf(UpdateBulkDto, reset(ENOUGH))).toEqual([]);
    });

    it('applies to the new password of a self-service change only', () => {
        expect(
            errorsOf(ChangePasswordDto, {
                currentPassword: 'a',
                newPassword: SHORT,
            }),
        ).toEqual([expect.stringMatching(/newPassword/)]);
        expect(
            errorsOf(ChangePasswordDto, {
                currentPassword: 'a',
                newPassword: ENOUGH,
            }),
        ).toEqual([]);
    });

    it('does not apply to login, so older short passwords still sign in', () => {
        expect(
            errorsOf(LoginDto, { username: 'admin', password: 'a' }),
        ).toEqual([]);
    });
});
