import { OfflineController } from './offline.controller';
import { Role } from '@grocery-pos/contracts';
const actor = {
    userId: '0123456789abcdef01234567',
    username: 'seller',
    roles: [Role.Seller],
};
it('forwards lease/catalog/release to the bound current user', async () => {
    const service = {
        lease: jest.fn().mockResolvedValue('lease'),
        catalog: jest.fn().mockResolvedValue('catalog'),
        release: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new OfflineController(service as never);
    expect(await controller.lease(actor, { terminalId: 'terminal' })).toBe(
        'lease',
    );
    expect(await controller.catalog(actor, { lease: 'id' })).toBe('catalog');
    await controller.release(actor, { id: 'id' }, { terminalId: 'terminal' });
    expect(service.release).toHaveBeenCalledWith(actor, 'id', {
        terminalId: 'terminal',
    });
});
it('keeps ordinary sync and explicit admin reconciliation separate', async () => {
    const service = {
        sync: jest.fn().mockResolvedValue({ createdAt: new Date(0) }),
    };
    const controller = new OfflineController(service as never);
    const body = {
        lease: 'id',
        idempotencyKey: 'key',
        soldAt: new Date().toISOString(),
        amountTendered: 100,
        lines: [],
    };
    await controller.sync(actor, body);
    expect(service.sync).toHaveBeenLastCalledWith(actor, body);
    await controller.reconcile(actor, { ...body, reason: 'Cash counted' });
    expect(service.sync).toHaveBeenLastCalledWith(
        actor,
        { ...body, reason: 'Cash counted' },
        true,
    );
});
