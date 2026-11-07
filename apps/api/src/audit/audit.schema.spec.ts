import 'reflect-metadata';
import mongoose from 'mongoose';
import { AuditAction } from '@grocery-pos/contracts';
import { AuditLogSchema } from './audit.schema';
const Model = mongoose.model('AuditSchemaGuardSpec', AuditLogSchema.clone());
it.each([
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
] as const)('rejects %s before any database write', async (method) => {
    const id = new mongoose.Types.ObjectId();
    const filter = { _id: id };
    const update = { $set: { actorName: 'changed' } };
    const queries = {
        updateOne: () => Model.updateOne(filter, update),
        updateMany: () => Model.updateMany(filter, update),
        findOneAndUpdate: () => Model.findOneAndUpdate(filter, update),
        replaceOne: () => Model.replaceOne(filter, { actorName: 'changed' }),
        findOneAndReplace: () =>
            Model.findOneAndReplace(filter, { actorName: 'changed' }),
        deleteOne: () => Model.deleteOne(filter),
        deleteMany: () => Model.deleteMany(filter),
        findOneAndDelete: () => Model.findOneAndDelete(filter),
    };
    const query = queries[method]();
    await expect(query.exec()).rejects.toThrow('append-only');
});
it('blocks existing document save and document deletion', async () => {
    const doc = new Model({
        action: AuditAction.USER_CREATED,
        targetModel: 'User',
    });
    doc.isNew = false;
    await expect(doc.save()).rejects.toThrow('append-only');
    await expect(doc.deleteOne()).rejects.toThrow('append-only');
});
it('blocks bulk mutation and has no expiry index', async () => {
    await expect(
        Model.bulkWrite([
            { deleteOne: { filter: { _id: new mongoose.Types.ObjectId() } } },
        ]),
    ).rejects.toThrow('append-only');
    expect(
        AuditLogSchema.indexes().some(
            ([, options]) => options.expireAfterSeconds !== undefined,
        ),
    ).toBe(false);
});
it('indexes failed-login names for the username filter, partially (#143)', () => {
    expect(AuditLogSchema.indexes()).toContainEqual([
        { 'after.name': 1, createdAt: -1 },
        expect.objectContaining({
            partialFilterExpression: {
                action: AuditAction.AUTH_LOGIN_FAILED,
            },
        }),
    ]);
});
