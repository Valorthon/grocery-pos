import { Role, StockCountStatus } from '@grocery-pos/contracts';
import { StockCountController } from './stock-count.controller';
import type { StockCountService } from './stock-count.service';
describe('stock count route delegates', () => {
    it('passes validated actor/version and approval header through to the transaction service', async () => {
        const service = {
            list: jest.fn(),
            get: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            transition: jest.fn(),
            approve: jest.fn(),
        };
        const controller = new StockCountController(
            service as unknown as StockCountService,
        );
        const actor = {
            userId: 'id',
            username: 'counter',
            roles: [Role.Adjuster],
        };
        await controller.list({ page: 1, limit: 20 });
        await controller.get({ id: 'count' });
        await controller.create(actor, { scope: 'all' });
        await controller.save(
            actor,
            { id: 'count' },
            { version: 3, lines: [] },
        );
        await controller.submit(actor, { id: 'count' }, { version: 3 });
        await controller.cancel(actor, { id: 'count' }, { version: 3 });
        await controller.approve(
            actor,
            { id: 'count' },
            { version: 3 },
            'token',
        );
        expect(service.transition).toHaveBeenCalledWith(
            actor,
            'count',
            3,
            StockCountStatus.SUBMITTED,
        );
        expect(service.transition).toHaveBeenCalledWith(
            actor,
            'count',
            3,
            StockCountStatus.CANCELLED,
        );
        expect(service.approve).toHaveBeenCalledWith(
            actor,
            'count',
            3,
            'token',
        );
    });
});
