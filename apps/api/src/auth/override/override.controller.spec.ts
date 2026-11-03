import type { Request, Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import {
    DiscountType,
    OverrideAction,
    PaymentType,
    Role,
    TenderType,
    type AuthUser,
} from '@grocery-pos/contracts';
import {
    ManagerOverrideController,
    OverridePinController,
} from './override.controller';
import { ManagerOverrideService } from './override.service';
import { ManagerOverrideDto, SetOverridePinDto } from './override.dto';
import { LoginAttemptLimiter } from '../rate-limit/rate-limit';

const actor: AuthUser = {
    userId: new Types.ObjectId().toString(),
    username: 'cashier',
    roles: [Role.Seller],
};
function body() {
    return {
        username: '  BOSS  ',
        pin: '012345',
        action: OverrideAction.DISCOUNT,
        context: {
            expectedSubtotal: 1000,
            sale: {
                idempotencyKey: '7f37fca4-6fab-4b71-b179-1ecbf9cf0000',
                paymentType: PaymentType.CASH,
                tenders: [{ type: TenderType.CASH, amount: 1000 }],
                sellDetails: [
                    { product: new Types.ObjectId().toString(), quantity: 1 },
                ],
                discount: {
                    type: DiscountType.FIXED,
                    value: 1,
                    reason: ' Promotion ',
                },
            },
        },
    };
}
describe('manager approval boundary', () => {
    it('counts normalized manager attempts before testing credentials, in a separate namespace', async () => {
        const service = {
            issue: jest.fn().mockResolvedValue({ token: 'token' }),
        };
        const limiter = { hit: jest.fn().mockResolvedValue(undefined) };
        const controller = new ManagerOverrideController(
            service as unknown as ManagerOverrideService,
            limiter as unknown as LoginAttemptLimiter,
        );
        const dto = plainToInstance(ManagerOverrideDto, body());
        expect(await validate(dto)).toEqual([]);
        expect(dto.username).toBe('boss');
        expect(dto.context.sale!.discount!.reason).toBe('Promotion');
        expect(dto.pin).toBe('012345');
        const req = { ip: '127.0.0.1' } as Request;
        const res = {} as Response;
        expect(await controller.approve(actor, dto, req, res)).toEqual({
            token: 'token',
        });
        expect(limiter.hit).toHaveBeenCalledWith(
            res,
            '127.0.0.1',
            'boss',
            'override',
        );
        expect(service.issue).toHaveBeenCalledWith(actor, dto);
        expect(limiter.hit.mock.invocationCallOrder[0]).toBeLessThan(
            service.issue.mock.invocationCallOrder[0],
        );
    });
    it('does not run credential verification when the attempt is rate limited', async () => {
        const service = { issue: jest.fn() };
        const controller = new ManagerOverrideController(
            service as unknown as ManagerOverrideService,
            {
                hit: jest.fn().mockRejectedValue(new Error('rate-limited')),
            } as unknown as LoginAttemptLimiter,
        );
        await expect(
            controller.approve(
                actor,
                plainToInstance(ManagerOverrideDto, body()),
                {} as Request,
                {} as Response,
            ),
        ).rejects.toThrow('rate-limited');
        expect(service.issue).not.toHaveBeenCalled();
    });
    it('delegates PIN changes with the authenticated admin identity and target', async () => {
        const service = { setPin: jest.fn().mockResolvedValue(undefined) };
        const controller = new OverridePinController(
            service as unknown as ManagerOverrideService,
        );
        const id = new Types.ObjectId().toString();
        await controller.setPin(actor, { id }, { pin: null });
        expect(service.setPin).toHaveBeenCalledWith(actor, id, { pin: null });
    });
    it.each(['12345', '1234567', '123a56', ' 123456', '123456 '])(
        'rejects invalid PIN %j without normalizing it',
        async (pin) => {
            const dto = plainToInstance(ManagerOverrideDto, { ...body(), pin });
            expect(
                (await validate(dto)).some((e) => e.property === 'pin'),
            ).toBe(true);
            expect(dto.pin).toBe(pin);
        },
    );
    it('validates nested reversal context and explicit PIN clearing', async () => {
        const dto = plainToInstance(ManagerOverrideDto, {
            username: ' Admin ',
            pin: '012345',
            action: OverrideAction.VOID,
            context: {
                reversal: {
                    saleId: new Types.ObjectId().toString(),
                    reason: ' Returned ',
                },
            },
        });
        expect(await validate(dto)).toEqual([]);
        expect(dto.context.reversal!.reason).toBe('Returned');
        for (const pin of ['012345', null])
            expect(
                await validate(plainToInstance(SetOverridePinDto, { pin })),
            ).toEqual([]);
        expect(
            await validate(plainToInstance(SetOverridePinDto, {})),
        ).not.toEqual([]);
    });
    it('does not transform non-string usernames into a credential', async () => {
        const dto = plainToInstance(ManagerOverrideDto, {
            ...body(),
            username: 42,
        });
        expect(
            (await validate(dto)).some((e) => e.property === 'username'),
        ).toBe(true);
    });
});
