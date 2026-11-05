import { CategoryService } from './category.service';
import { CategoryController } from './category.controller';
import {
    CreateCategoryDto,
    UpdateCategoryDto,
    CategoryQueryDto,
    CategoryIdDto,
} from './category.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';
import { Test } from '@nestjs/testing';

function fixture() {
    const row = {
        _id: new Types.ObjectId(),
        name: 'Frozen',
        isActive: true,
        sortOrder: 0,
    };
    const query = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(row),
    };
    const model = {
        init: jest.fn().mockResolvedValue(undefined),
        find: jest.fn((filter: unknown) => {
            void filter;
            return { ...query, lean: jest.fn().mockResolvedValue([row]) };
        }),
        countDocuments: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue([row]),
        findById: jest.fn(() => ({
            session: () => ({ lean: () => ({ orFail: async () => row }) }),
        })),
        findByIdAndUpdate: jest.fn(() => query),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    const exists = jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(null) });
    const session = {
        withTransaction: async (fn: (s: unknown) => unknown) => fn(session),
        endSession: jest.fn(),
    };
    const service = new CategoryService(
        { startSession: async () => session } as never,
        model as never,
        { exists } as never,
    );
    return { service, model, query, row, exists, session };
}
describe('category startup readiness', () => {
    it('holds Nest startup until the unique index is ready', async () => {
        const f = fixture();
        let ready!: () => void;
        const indexes = new Promise<void>((resolve) => {
            ready = resolve;
        });
        f.model.init.mockReturnValue(indexes);
        const moduleRef = await Test.createTestingModule({
            providers: [{ provide: CategoryService, useValue: f.service }],
        }).compile();
        const app = moduleRef.createNestApplication({ logger: false });
        let started = false;
        const startup = app.init().then(() => {
            started = true;
        });
        try {
            // Give Nest's lifecycle hook a full turn; the unresolved index build
            // must prevent readiness even though the database is connected.
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(f.model.init).toHaveBeenCalledTimes(1);
            expect(started).toBe(false);
            ready();
            await startup;
            expect(started).toBe(true);
        } finally {
            ready();
            await startup;
            await app.close();
        }
    });
    it('fails startup when a unique index cannot be built', async () => {
        const f = fixture();
        const failure = new Error(
            'duplicate category names prevent index creation',
        );
        f.model.init.mockRejectedValue(failure);
        await expect(f.service.onModuleInit()).rejects.toBe(failure);
    });
});
describe('category lifecycle', () => {
    it.each([undefined, 'active', 'archived', 'all'] as const)(
        'lists bounded sorted %s categories with safe name search',
        async (status) => {
            const f = fixture();
            const dto = { page: 2, limit: 5, status, name: ' [FROZEN] ' };
            expect(await f.service.list(dto)).toEqual({
                data: [f.row],
                totalItems: 1,
            });
            expect(f.model.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    nameKey: { $regex: '\\[frozen\\]' },
                }),
            );
            const filter = f.model.find.mock.calls[0]![0] as unknown;
            if (status === 'all') expect(filter).not.toHaveProperty('isActive');
            else
                expect(filter).toHaveProperty(
                    'isActive',
                    status !== 'archived',
                );
        },
    );
    it('lists without a name, and creates a normalized unique key', async () => {
        const f = fixture();
        await f.service.list({ page: 1, limit: 100 });
        expect(f.model.find).toHaveBeenCalledWith({ isActive: true });
        expect(await f.service.create({ name: 'Frozen' })).toEqual(f.row);
        expect(f.model.create).toHaveBeenCalledWith(
            [{ name: 'Frozen', nameKey: 'frozen' }],
            { session: f.session },
        );
    });
    it.each([{ name: 'New Name' }, { isActive: false }, { sortOrder: 3 }])(
        'updates category %o in a transaction',
        async (dto) => {
            const f = fixture();
            expect(await f.service.update(String(f.row._id), dto)).toEqual(
                f.row,
            );
            expect(f.model.findByIdAndUpdate).toHaveBeenCalledWith(
                String(f.row._id),
                expect.objectContaining({ $inc: { assignmentVersion: 1 } }),
                expect.anything(),
            );
            expect(f.session.endSession).toHaveBeenCalled();
        },
    );
    it('rejects missing categories, including delete', async () => {
        const f = fixture();
        f.query.lean.mockResolvedValue(null);
        await expect(
            f.service.update(String(f.row._id), { name: 'New' }),
        ).rejects.toThrow('Category not found');
        f.model.findByIdAndUpdate.mockReturnValue(null as never);
        await expect(f.service.remove(String(f.row._id))).rejects.toThrow(
            'Category not found',
        );
    });
    it('deletes an unreferenced category, refuses all product references', async () => {
        const f = fixture();
        f.model.findByIdAndUpdate.mockReturnValue({
            then: (resolve: (v: unknown) => void) => resolve(f.row),
        } as never);
        await f.service.remove(String(f.row._id));
        expect(f.model.deleteOne).toHaveBeenCalled();
        f.exists.mockReturnValue({
            session: async () => ({ _id: new Types.ObjectId() }),
        });
        await expect(f.service.remove(String(f.row._id))).rejects.toThrow(
            'archive it instead',
        );
        expect(f.model.deleteOne).toHaveBeenCalledTimes(1);
    });
    it('locks active assignment and refuses inactive/missing categories', async () => {
        const f = fixture();
        await f.service.assertAssignable(String(f.row._id), f.session as never);
        expect(f.model.updateOne).toHaveBeenCalledWith(
            { _id: String(f.row._id), isActive: true },
            { $inc: { assignmentVersion: 1 } },
            { session: f.session },
        );
        f.model.updateOne.mockResolvedValue({ matchedCount: 0 });
        await expect(
            f.service.assertAssignable(String(f.row._id), f.session as never),
        ).rejects.toThrow('Choose an active category');
    });
    it('controller preserves wire response and delegates every operation', async () => {
        const f = fixture();
        const service = {
            list: jest.fn().mockResolvedValue({ data: [f.row], totalItems: 1 }),
            create: jest.fn().mockResolvedValue(f.row),
            update: jest.fn().mockResolvedValue(f.row),
            remove: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new CategoryController(service as never);
        expect(await controller.list({ page: 1, limit: 100 })).toEqual({
            data: [f.row],
            totalItems: 1,
        });
        expect(await controller.create({ name: 'Frozen' })).toEqual(f.row);
        expect(
            await controller.update(
                { id: String(f.row._id) },
                { isActive: false },
            ),
        ).toEqual(f.row);
        await controller.remove({ id: String(f.row._id) });
        expect(service.remove).toHaveBeenCalledWith(String(f.row._id));
    });
});
describe('category DTO validation', () => {
    it.each([
        [CreateCategoryDto, { name: ' Frozen ' }, true],
        [CreateCategoryDto, { name: ' ' }, false],
        [CreateCategoryDto, { name: 'x'.repeat(61) }, false],
        [UpdateCategoryDto, {}, false],
        [UpdateCategoryDto, { name: null }, false],
        [UpdateCategoryDto, { isActive: null }, false],
        [UpdateCategoryDto, { sortOrder: -1 }, false],
        [UpdateCategoryDto, { sortOrder: 1.5 }, false],
        [UpdateCategoryDto, { sortOrder: 1000001 }, false],
        [UpdateCategoryDto, { isActive: false }, true],
        [CategoryQueryDto, { page: 1, limit: 101 }, false],
        [CategoryQueryDto, { page: 10001, limit: 10 }, false],
        [CategoryQueryDto, { status: 'bad' }, false],
        [CategoryQueryDto, {}, true],
        [CategoryIdDto, { id: 'invalid' }, false],
        [CategoryIdDto, { id: new Types.ObjectId().toString() }, true],
    ] as const)('validates %p %o', async (type, input, ok) => {
        const dto = plainToInstance(type as typeof CreateCategoryDto, input);
        expect((await validate(dto)).length === 0).toBe(ok);
    });
});
