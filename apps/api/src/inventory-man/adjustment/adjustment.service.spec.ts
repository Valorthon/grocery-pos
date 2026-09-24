import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ClientSession } from 'mongoose';
import { AdjustmentService } from './adjustment.service';
import { Adjustment } from './adjustment.schema';
import { AdjustmentDetails } from './adjustment-details.schema';
import { InventoryService } from '../inventory/inventory.service';
import { ErrorCode, NotFoundError, ValidationError } from '../../common/errors';
import { AdjustDto } from './types';
import { AuthUser } from '../../auth/types';
import { Role } from '@grocery-pos/contracts';

const ADMIN: AuthUser = {
    userId: 'u1',
    username: 'admin',
    roles: [Role.Admin],
};

function adjustDto(details: { product: string; change: number }[]): AdjustDto {
    return {
        description: 'stock count',
        adjustDetails: details.map((d) => ({ ...d, reason: 'recount' })),
    } as AdjustDto;
}

describe('AdjustmentService.adjust', () => {
    let service: AdjustmentService;
    let create: jest.Mock;
    let detailsBulkWrite: jest.Mock;
    let assertAdjustable: jest.Mock;
    let inventoryAdjust: jest.Mock;

    beforeEach(async () => {
        create = jest.fn().mockResolvedValue([{ _id: 'adj1' }]);
        detailsBulkWrite = jest.fn().mockResolvedValue(undefined);
        assertAdjustable = jest.fn().mockResolvedValue(undefined);
        inventoryAdjust = jest.fn().mockResolvedValue(undefined);

        const session = {
            withTransaction: async (fn: (s: ClientSession) => unknown) =>
                fn({} as ClientSession),
            endSession: jest.fn(),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                AdjustmentService,
                {
                    provide: getConnectionToken(),
                    useValue: { startSession: () => Promise.resolve(session) },
                },
                {
                    provide: getModelToken(Adjustment.name),
                    useValue: { create },
                },
                {
                    provide: getModelToken(AdjustmentDetails.name),
                    useValue: { bulkWrite: detailsBulkWrite },
                },
                {
                    provide: InventoryService,
                    useValue: {
                        assertAdjustable,
                        adjust: inventoryAdjust,
                    },
                },
            ],
        }).compile();

        service = moduleRef.get(AdjustmentService);
    });

    it('records details only after the stock change has been applied', async () => {
        await service.adjust(ADMIN, adjustDto([{ product: 'p1', change: 3 }]));

        expect(assertAdjustable).toHaveBeenCalled();
        expect(inventoryAdjust).toHaveBeenCalled();
        expect(detailsBulkWrite).toHaveBeenCalledTimes(1);
        expect(inventoryAdjust.mock.invocationCallOrder[0]).toBeLessThan(
            detailsBulkWrite.mock.invocationCallOrder[0],
        );
    });

    it('writes no details row for a product with no inventory row', async () => {
        assertAdjustable.mockRejectedValue(
            new NotFoundError(ErrorCode.PRODUCT_NOT_FOUND, 'missing', [
                { product: 'ghost' },
            ]),
        );

        await expect(
            service.adjust(ADMIN, adjustDto([{ product: 'ghost', change: 5 }])),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(inventoryAdjust).not.toHaveBeenCalled();
        expect(detailsBulkWrite).not.toHaveBeenCalled();
    });

    it('writes no details row when the stock guard rejects the change', async () => {
        inventoryAdjust.mockRejectedValue(
            new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'would go negative',
            ),
        );

        await expect(
            service.adjust(
                ADMIN,
                adjustDto([{ product: 'p1', change: -999999 }]),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(detailsBulkWrite).not.toHaveBeenCalled();
    });
});
