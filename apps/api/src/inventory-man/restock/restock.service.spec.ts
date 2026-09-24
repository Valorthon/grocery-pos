import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { RestockService } from './restock.service';
import { Restock } from './restock.schema';
import { RestockDetails } from './restock-details.schema';
import { InventoryService } from '../inventory/inventory.service';
import { ProductService } from '../../product/product.service';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import { GetAllDto } from './types';

describe('RestockService.getAll date filter', () => {
    let service: RestockService;
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
                RestockService,
                { provide: getConnectionToken(), useValue: {} },
                {
                    provide: getModelToken(Restock.name),
                    useValue: { find, countDocuments },
                },
                { provide: getModelToken(RestockDetails.name), useValue: {} },
                { provide: InventoryService, useValue: {} },
                { provide: ProductService, useValue: {} },
                {
                    provide: TypedConfigService,
                    useValue: { get: () => 'Asia/Manila' },
                },
            ],
        }).compile();

        service = moduleRef.get(RestockService);
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
