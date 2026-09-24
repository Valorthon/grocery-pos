import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ClientSession } from 'mongoose';
import { AdjustmentService } from './adjustment.service';
import { Adjustment } from './adjustment.schema';
import { AdjustmentDetails } from './adjustment-details.schema';
import { InventoryService } from '../inventory/inventory.service';
import { ErrorCode, NotFoundError, ValidationError } from '../../common/errors';
import { AdjustDto, GetAllDto } from './types';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
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
    let inventoryAdjust: jest.Mock;

    beforeEach(async () => {
        create = jest.fn().mockResolvedValue([{ _id: 'adj1' }]);
        detailsBulkWrite = jest.fn().mockResolvedValue(undefined);
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
                    useValue: { adjust: inventoryAdjust },
                },
                {
                    provide: TypedConfigService,
                    useValue: { get: () => 'Asia/Manila' },
                },
            ],
        }).compile();

        service = moduleRef.get(AdjustmentService);
    });

    it('records details only after the stock change has been applied', async () => {
        await service.adjust(ADMIN, adjustDto([{ product: 'p1', change: 3 }]));

        expect(inventoryAdjust).toHaveBeenCalled();
        expect(detailsBulkWrite).toHaveBeenCalledTimes(1);
        expect(inventoryAdjust.mock.invocationCallOrder[0]).toBeLessThan(
            detailsBulkWrite.mock.invocationCallOrder[0],
        );
    });

    it('writes no details row for a product with no inventory row', async () => {
        inventoryAdjust.mockRejectedValue(
            new NotFoundError(ErrorCode.PRODUCT_NOT_FOUND, 'missing', [
                { product: 'ghost' },
            ]),
        );

        await expect(
            service.adjust(ADMIN, adjustDto([{ product: 'ghost', change: 5 }])),
        ).rejects.toMatchObject({ statusCode: 404 });

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

describe('AdjustmentService.getAll date filter', () => {
    let service: AdjustmentService;
    let find: jest.Mock;
    let countDocuments: jest.Mock;

    beforeEach(async () => {
        const chain = {
            sort: () => chain,
            skip: () => chain,
            limit: () => chain,
            populate: () => chain,
            lean: () => Promise.resolve([]),
        };
        find = jest.fn().mockReturnValue(chain);
        countDocuments = jest.fn().mockResolvedValue(0);

        const moduleRef = await Test.createTestingModule({
            providers: [
                AdjustmentService,
                { provide: getConnectionToken(), useValue: {} },
                {
                    provide: getModelToken(Adjustment.name),
                    useValue: {
                        find,
                        countDocuments,
                        estimatedDocumentCount: jest.fn(),
                    },
                },
                {
                    provide: getModelToken(AdjustmentDetails.name),
                    useValue: {},
                },
                { provide: InventoryService, useValue: {} },
                {
                    provide: TypedConfigService,
                    useValue: { get: () => 'Asia/Manila' },
                },
            ],
        }).compile();

        service = moduleRef.get(AdjustmentService);
    });

    function query(): Record<string, unknown> {
        return find.mock.calls[0][0] as Record<string, unknown>;
    }

    it('bounds both ends by whole Manila days', async () => {
        await service.getAll({
            page: 1,
            limit: 5,
            dateFrom: '2026-01-05',
            dateTo: '2026-01-05',
        } as GetAllDto);

        expect(query().createdAt).toEqual({
            $gte: new Date('2026-01-04T16:00:00.000Z'),
            $lt: new Date('2026-01-05T16:00:00.000Z'),
        });
        expect(countDocuments).toHaveBeenCalledWith(query());
    });

    it('applies a start-only range', async () => {
        await service.getAll({
            page: 1,
            limit: 5,
            dateFrom: '2026-01-05',
        } as GetAllDto);

        expect(query().createdAt).toEqual({
            $gte: new Date('2026-01-04T16:00:00.000Z'),
        });
    });

    it('applies an end-only range', async () => {
        await service.getAll({
            page: 1,
            limit: 5,
            dateTo: '2026-01-05',
        } as GetAllDto);

        expect(query().createdAt).toEqual({
            $lt: new Date('2026-01-05T16:00:00.000Z'),
        });
    });

    it('omits the date filter when no dates are given', async () => {
        await service.getAll({ page: 1, limit: 5 } as GetAllDto);

        expect(query()).not.toHaveProperty('createdAt');
    });

    it('does not mutate the DTO', async () => {
        const dto = Object.freeze({
            page: 1,
            limit: 5,
            dateFrom: '2026-01-05',
            dateTo: '2026-01-06',
        }) as GetAllDto;
        const snapshot = { ...dto };

        await service.getAll(dto);

        expect(dto).toEqual(snapshot);
    });
});
