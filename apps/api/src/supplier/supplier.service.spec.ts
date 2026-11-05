import { Types } from 'mongoose';
import { SupplierService } from './supplier.service';
import { SupplierController } from './supplier.controller';
import {
    SupplierFieldsDto,
    SupplierQueryDto,
    UpdateSupplierDto,
} from './supplier.dto';
import { Role } from '@grocery-pos/contracts';

class Query<T> {
    constructor(readonly value: T) {}
    sort = jest.fn(() => this);
    skip = jest.fn(() => this);
    limit = jest.fn(() => this);
    select = jest.fn(() => this);
    session = jest.fn(() => this);
    lean = jest.fn(() => this);
    orFail = jest.fn(async () => this.value);
    then<R>(resolve: (value: T) => R) {
        return Promise.resolve(this.value).then(resolve);
    }
}
function fixture() {
    const row = { _id: new Types.ObjectId(), name: 'Farm', isActive: true };
    const list = new Query([row]),
        one = new Query<typeof row | null>(row);
    const suppliers = {
        find: jest.fn((filter: unknown) => {
            if (!filter) throw new Error('Missing filter');
            return list;
        }),
        countDocuments: jest.fn(async () => 1),
        create: jest.fn(async () => row),
        findById: jest.fn(() => one),
        findByIdAndUpdate: jest.fn(() => one),
        deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
        updateOne: jest.fn(async () => ({ matchedCount: 1 })),
    };
    const restocks = { exists: jest.fn(() => new Query<unknown>(null)) };
    const costs = new Query([
        {
            ...row,
            price: 1000,
            lastCost: 400,
            costUpdatedAt: new Date('2026-11-05T00:00:00Z'),
        },
    ]);
    const products = { find: jest.fn(() => costs) };
    const session = {
        withTransaction: async (fn: (s: unknown) => unknown) => fn(session),
        endSession: jest.fn(),
    };
    const connection = { startSession: jest.fn(async () => session) };
    const service = new SupplierService(
        connection as never,
        suppliers as never,
        restocks as never,
        products as never,
    );
    return {
        service,
        suppliers,
        restocks,
        products,
        row,
        list,
        one,
        costs,
        session,
    };
}
describe('supplier lifecycle and confidential cost defaults', () => {
    it.each(['active', 'archived', 'all', undefined] as const)(
        'filters %s suppliers and pages deterministically',
        async (status) => {
            const f = fixture();
            const dto = Object.assign(new SupplierQueryDto(), {
                status,
                page: 2,
                limit: 5,
                name: 'Farm.*',
            });
            expect(await f.service.list(dto)).toEqual({
                data: [f.row],
                totalItems: 1,
            });
            const filter = f.suppliers.find.mock.calls[0][0] as {
                name: { $regex: string };
                isActive?: boolean;
            };
            expect(new RegExp(filter.name.$regex).test('Farm.*')).toBe(true);
            expect(new RegExp(filter.name.$regex).test('Farmer')).toBe(false);
            expect(filter.isActive).toBe(
                status === 'all' ? undefined : status !== 'archived',
            );
            expect(f.list.skip).toHaveBeenCalledWith(5);
        },
    );
    it('lists without a name filter and creates a public projection', async () => {
        const f = fixture();
        await f.service.list(new SupplierQueryDto());
        expect(f.suppliers.find).toHaveBeenCalledWith({ isActive: true });
        expect(
            await f.service.create(
                Object.assign(new SupplierFieldsDto(), { name: 'Farm' }),
            ),
        ).toEqual(f.row);
        expect(f.suppliers.findById).toHaveBeenCalledWith(f.row._id);
    });
    it('updates inside a transaction and returns 404 for missing suppliers', async () => {
        const f = fixture(),
            patch = Object.assign(new UpdateSupplierDto(), { isActive: false });
        expect(await f.service.update(String(f.row._id), patch)).toEqual(f.row);
        expect(f.suppliers.findByIdAndUpdate).toHaveBeenCalledWith(
            String(f.row._id),
            { $set: patch, $inc: { receiptVersion: 1 } },
            { new: true, runValidators: true, session: f.session },
        );
        f.suppliers.findByIdAndUpdate.mockReturnValue(new Query(null));
        await expect(
            f.service.update(String(f.row._id), patch),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
    it('deletes only suppliers with no receipt references', async () => {
        const f = fixture();
        await f.service.remove(String(f.row._id));
        expect(f.suppliers.deleteOne).toHaveBeenCalledWith(
            { _id: String(f.row._id) },
            { session: f.session },
        );
        f.restocks.exists.mockReturnValue(new Query({ _id: 'receipt' }));
        await expect(f.service.remove(String(f.row._id))).rejects.toMatchObject(
            { statusCode: 400 },
        );
        f.suppliers.findByIdAndUpdate.mockReturnValue(new Query(null));
        await expect(f.service.remove(String(f.row._id))).rejects.toMatchObject(
            { statusCode: 404 },
        );
    });
    it('locks active suppliers in the receipt transaction and rejects unavailable suppliers', async () => {
        const f = fixture();
        await f.service.assertActive(String(f.row._id), f.session as never);
        expect(f.suppliers.updateOne).toHaveBeenCalledWith(
            { _id: String(f.row._id), isActive: true },
            { $inc: { receiptVersion: 1 } },
            { session: f.session },
        );
        f.suppliers.updateOne.mockResolvedValue({ matchedCount: 0 });
        await expect(
            f.service.assertActive(String(f.row._id), f.session as never),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
    it('returns procurement cost without margin for non-admin, and estimates for admin', async () => {
        const f = fixture();
        const expected = {
            product: String(f.row._id),
            lastCost: 400,
            costUpdatedAt: '2026-11-05T00:00:00.000Z',
        };
        expect(await f.service.costs([String(f.row._id)], false)).toEqual([
            expected,
        ]);
        expect(await f.service.costs([String(f.row._id)], true)).toEqual([
            { ...expected, marginBasisPoints: 6000 },
        ]);
    });
    it('preserves missing and zero cost, including negative margin', async () => {
        const f = fixture();
        f.products.find.mockReturnValue(
            new Query([
                { _id: f.row._id, price: 1 } as never,
                { _id: f.row._id, price: 1000, lastCost: 0 } as never,
                { _id: f.row._id, price: 1000, lastCost: 2000 } as never,
            ]),
        );
        expect(await f.service.costs([], true)).toEqual([
            { product: String(f.row._id) },
            {
                product: String(f.row._id),
                lastCost: 0,
                marginBasisPoints: 10000,
            },
            {
                product: String(f.row._id),
                lastCost: 2000,
                marginBasisPoints: -10000,
            },
        ]);
    });
    it('controller preserves exact DTOs and enables margin only for admins', async () => {
        const f = fixture(),
            controller = new SupplierController(f.service);
        const costs = jest.spyOn(f.service, 'costs').mockResolvedValue([]);
        await controller.costs({ products: ['id'] }, {
            roles: [Role.Restocker],
        } as never);
        expect(costs).toHaveBeenLastCalledWith(['id'], false);
        await controller.costs({ products: ['id'] }, {
            roles: [Role.Admin],
        } as never);
        expect(costs).toHaveBeenLastCalledWith(['id'], true);
        expect(await controller.list(new SupplierQueryDto())).toMatchObject({
            totalItems: 1,
        });
        expect(await controller.create({ name: 'Farm' })).toMatchObject({
            name: 'Farm',
        });
        expect(
            await controller.update(
                { id: String(f.row._id) },
                { phone: '123' },
            ),
        ).toMatchObject({ name: 'Farm' });
        await controller.remove({ id: String(f.row._id) });
        expect(f.suppliers.deleteOne).toHaveBeenCalledTimes(1);
    });
});
