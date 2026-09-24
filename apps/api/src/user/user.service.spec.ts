import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import * as argon from 'argon2';
import { UserService } from './user.service';
import { User, UserSchema } from './user.schema';
import { Role } from '../auth/types';
import type { AuthUser } from '../auth/types';
import { AppError, ErrorCode } from '../common/errors';
import { UpdateBulkDto } from './types';
import {
    FakeUserModel,
    FakeUserRow,
    fakeConnection,
} from './testing/fake-user-model';

const as = (row: FakeUserRow, roles = row.roles): AuthUser => ({
    userId: row._id.toString(),
    username: row.name,
    roles,
});

async function rejection(promise: Promise<unknown>) {
    try {
        await promise;
    } catch (err) {
        const e = err as AppError;
        return { status: e.statusCode, code: e.code };
    }
    throw new Error('expected a rejection');
}

describe('UserService', () => {
    let service: UserService;
    let model: FakeUserModel;
    let admin: FakeUserRow;
    let manager: FakeUserRow;
    let cashier: FakeUserRow;

    beforeEach(async () => {
        model = new FakeUserModel();
        admin = model.seed({ name: 'admin', roles: [Role.Admin] });
        manager = model.seed({ name: 'manager', roles: [Role.UserManager] });
        cashier = model.seed({ name: 'cashier', roles: [Role.Seller] });

        const moduleRef = await Test.createTestingModule({
            providers: [
                UserService,
                {
                    provide: getConnectionToken(),
                    useValue: fakeConnection(model),
                },
                { provide: getModelToken(User.name), useValue: model },
            ],
        }).compile();

        service = moduleRef.get(UserService);
    });

    const update = (actor: AuthUser, updates: UpdateBulkDto['updates']) =>
        service.update(actor, { updates });

    describe('update', () => {
        it('applies each entry with updateOne + runValidators, never bulkWrite', async () => {
            await update(as(admin), [
                { user: cashier._id.toString(), update: { name: 'till1' } },
                {
                    user: manager._id.toString(),
                    update: { roles: [Role.UserManager, Role.Seller] },
                },
            ]);

            const updates = model.writes.filter((w) => w.op === 'updateOne');
            expect(updates).toHaveLength(2);
            for (const call of updates) {
                expect(call.options).toMatchObject({ runValidators: true });
                expect(call.options?.session).toBeDefined();
            }
            expect(model.byId(cashier._id)?.name).toBe('till1');
        });

        it('stores an argon2 hash, never the password', async () => {
            await update(as(admin), [
                {
                    user: cashier._id.toString(),
                    update: { password: 'new-secret' },
                },
            ]);

            const row = model.byId(cashier._id)!;
            expect(row).not.toHaveProperty('password');
            await expect(
                argon.verify(row.passwordHash, 'new-secret'),
            ).resolves.toBe(true);
        });

        it("authorizes with the actor's stored roles, not the JWT's", async () => {
            // A JWT minted before a demotion still says ADMIN.
            const stale = as(manager, [Role.Admin]);

            await expect(
                rejection(
                    update(stale, [
                        {
                            user: admin._id.toString(),
                            update: { password: 'x' },
                        },
                    ]),
                ),
            ).resolves.toEqual({
                status: 403,
                code: ErrorCode.USER_TARGET_FORBIDDEN,
            });
        });

        it('refuses a deactivated or deleted actor', async () => {
            model.byId(manager._id)!.isActive = false;
            const body = [
                { user: manager._id.toString(), update: { name: 'x' } },
            ];

            await expect(rejection(update(as(manager), body))).resolves.toEqual(
                { status: 403, code: ErrorCode.FORBIDDEN },
            );

            model.rows = model.rows.filter((r) => r !== manager);
            await expect(rejection(update(as(manager), body))).resolves.toEqual(
                { status: 403, code: ErrorCode.FORBIDDEN },
            );
        });

        it('answers an unknown target with 404 and changes nothing', async () => {
            const ghost = new mongoose.Types.ObjectId().toString();

            await expect(
                rejection(
                    update(as(admin), [
                        { user: cashier._id.toString(), update: { name: 'y' } },
                        { user: ghost, update: { name: 'z' } },
                    ]),
                ),
            ).resolves.toEqual({ status: 404, code: ErrorCode.NOT_FOUND });
            expect(model.byId(cashier._id)?.name).toBe('cashier');
        });

        it('rolls back the whole batch when one entry is forbidden', async () => {
            const manager2 = model.seed({
                name: 'manager2',
                roles: [Role.UserManager],
            });

            await expect(
                rejection(
                    update(as(manager), [
                        {
                            user: manager2._id.toString(),
                            update: { isActive: false },
                        },
                        {
                            user: admin._id.toString(),
                            update: { isActive: false },
                        },
                    ]),
                ),
            ).resolves.toEqual({
                status: 403,
                code: ErrorCode.USER_TARGET_FORBIDDEN,
            });
            expect(model.byId(manager2._id)?.isActive).toBe(true);
            expect(model.writes.some((w) => w.op === 'updateOne')).toBe(false);
        });

        it('returns the users whose roles or active flag changed (hook for #12)', async () => {
            const changed = await update(as(admin), [
                { user: cashier._id.toString(), update: { isActive: false } },
                {
                    user: manager._id.toString(),
                    update: { roles: [Role.UserManager], name: 'mgr' },
                },
            ]);

            expect(changed).toEqual([cashier._id.toString()]);
        });
    });

    describe('last active admin (rule 5)', () => {
        let admin2: FakeUserRow;

        beforeEach(() => {
            admin2 = model.seed({ name: 'admin2', roles: [Role.Admin] });
        });

        it('lets one of two admins demote the other', async () => {
            await update(as(admin), [
                {
                    user: admin2._id.toString(),
                    update: { roles: [Role.Seller] },
                },
            ]);

            expect(model.byId(admin2._id)?.roles).toEqual([Role.Seller]);
        });

        it('write-locks every active admin before a demotion', async () => {
            await update(as(admin), [
                { user: admin2._id.toString(), update: { isActive: false } },
            ]);

            const [first, second] = model.writes;
            expect(first).toMatchObject({
                op: 'updateMany',
                filter: { roles: Role.Admin, isActive: true },
            });
            expect(first.options?.session).toBeDefined();
            expect(second).toMatchObject({ op: 'updateOne' });
        });

        it('does not lock admins for changes that keep every admin', async () => {
            await update(as(admin), [
                { user: cashier._id.toString(), update: { isActive: false } },
            ]);

            expect(model.writes.some((w) => w.op === 'updateMany')).toBe(false);
        });

        it('refuses a bulk update that together removes every admin', async () => {
            await expect(
                rejection(
                    update(as(admin), [
                        {
                            user: admin2._id.toString(),
                            update: { roles: [Role.UserManager] },
                        },
                        {
                            user: admin._id.toString(),
                            update: { isActive: false },
                        },
                    ]),
                ),
            ).resolves.toEqual({
                status: 403,
                code: ErrorCode.USER_LAST_ADMIN,
            });

            expect(model.byId(admin._id)?.isActive).toBe(true);
            expect(model.byId(admin2._id)?.roles).toEqual([Role.Admin]);
        });

        it('refuses the second of two concurrent cross-demotions', async () => {
            const results = await Promise.allSettled([
                update(as(admin), [
                    {
                        user: admin2._id.toString(),
                        update: { isActive: false },
                    },
                ]),
                update(as(admin2), [
                    {
                        user: admin._id.toString(),
                        update: { roles: [Role.Seller] },
                    },
                ]),
            ]);

            // Whichever runs second sees the first one's commit: its actor is
            // no longer an active admin, so it is refused (403) either way.
            const refused = results.filter((r) => r.status === 'rejected');
            expect(refused).toHaveLength(1);
            expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
                statusCode: 403,
            });
            expect(
                model.rows.filter(
                    (r) => r.isActive && r.roles.includes(Role.Admin),
                ),
            ).toHaveLength(1);
        });

        it('ignores inactive admins when counting', async () => {
            model.byId(admin2._id)!.isActive = false;

            await expect(
                rejection(
                    update(as(admin), [
                        {
                            user: admin._id.toString(),
                            update: { isActive: false },
                        },
                    ]),
                ),
            ).resolves.toEqual({
                status: 403,
                code: ErrorCode.USER_LAST_ADMIN,
            });
        });
    });

    describe('create', () => {
        it('refuses a manager creating an ADMIN, and inserts nothing', async () => {
            await expect(
                rejection(
                    service.create(as(manager), {
                        users: [
                            {
                                name: 'mole',
                                password: 'pw',
                                roles: [Role.Admin],
                            },
                        ],
                    }),
                ),
            ).resolves.toEqual({
                status: 403,
                code: ErrorCode.USER_ROLE_NOT_GRANTABLE,
            });
            expect(model.rows.some((r) => r.name === 'mole')).toBe(false);
        });

        it('lets a manager create a fellow manager and an admin create anyone', async () => {
            await service.create(as(manager), {
                users: [
                    { name: 'm3', password: 'pw', roles: [Role.UserManager] },
                ],
            });
            await service.create(as(admin), {
                users: [
                    {
                        name: 'boss2',
                        password: 'pw',
                        roles: [Role.Admin, Role.Seller],
                    },
                ],
            });

            expect(model.rows.map((r) => r.name)).toEqual(
                expect.arrayContaining(['m3', 'boss2']),
            );
        });
    });

    describe('changeOwnPassword', () => {
        beforeEach(async () => {
            model.byId(cashier._id)!.passwordHash = await argon.hash('old-pw');
        });

        it('changes the password when the current one matches', async () => {
            await service.changeOwnPassword(as(cashier), {
                currentPassword: 'old-pw',
                newPassword: 'new-pw',
            });

            await expect(
                service.checkCredentials('cashier', 'new-pw'),
            ).resolves.toMatchObject({ name: 'cashier' });
            await expect(
                service.checkCredentials('cashier', 'old-pw'),
            ).resolves.toBeNull();
        });

        it('refuses a wrong current password with 403', async () => {
            await expect(
                rejection(
                    service.changeOwnPassword(as(cashier), {
                        currentPassword: 'guess',
                        newPassword: 'new-pw',
                    }),
                ),
            ).resolves.toEqual({
                status: 403,
                code: ErrorCode.USER_WRONG_PASSWORD,
            });
            await expect(
                argon.verify(model.byId(cashier._id)!.passwordHash, 'old-pw'),
            ).resolves.toBe(true);
        });
    });
});

describe('User schema roles', () => {
    const UserModel = mongoose.model(User.name, UserSchema);

    const rolesError = (roles: string[]) =>
        new UserModel({ name: 'a', passwordHash: 'h', roles }).validateSync()
            ?.errors['roles.0']?.kind;

    it('stores assignable roles and rejects UNAUTHENTICATED', () => {
        expect(rolesError([Role.Admin])).toBeUndefined();
        expect(rolesError([Role.Unauthenticated])).toBe('enum');
    });
});
