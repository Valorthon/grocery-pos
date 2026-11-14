import { Role } from '@grocery-pos/contracts';
import { UserController } from './user.controller';
import type { UserService } from './user.service';
import type { RefreshTokenService } from '../auth/refresh-token/refresh-token.service';

describe('UserController.getProfile', () => {
    it('returns the user id, username and roles, and nothing else', () => {
        const controller = new UserController(
            {} as UserService,
            {} as RefreshTokenService,
        );

        expect(
            controller.getProfile({
                userId: '507f1f77bcf86cd799439011',
                username: 'ana',
                roles: [Role.Seller],
                sid: 'session-1',
            }),
        ).toEqual({
            userId: '507f1f77bcf86cd799439011',
            username: 'ana',
            roles: [Role.Seller],
        });
    });

    it('adds mustChangePassword only while it is set (#361)', () => {
        const controller = new UserController(
            {} as UserService,
            {} as RefreshTokenService,
        );
        expect(
            controller.getProfile({
                userId: '507f1f77bcf86cd799439011',
                username: 'owner',
                roles: [Role.Admin],
                mustChangePassword: true,
            }),
        ).toEqual({
            userId: '507f1f77bcf86cd799439011',
            username: 'owner',
            roles: [Role.Admin],
            mustChangePassword: true,
        });
    });
});
