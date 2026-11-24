import { Types } from 'mongoose';
import { findInvalidProductNames } from './product-name-characters';

const A = new Types.ObjectId();
const B = new Types.ObjectId();

describe('findInvalidProductNames (#483)', () => {
    it('requires a database', async () => {
        await expect(
            findInvalidProductNames({ db: null } as never),
        ).rejects.toThrow('Not connected');
    });

    it('lists only the names with disallowed characters and writes nothing', async () => {
        const products = {
            find: jest.fn().mockReturnValue({
                toArray: async () => [
                    { _id: A, name: 'PIÑA (1/2 KG)' },
                    {
                        _id: B,
                        name: 'QA 🍎 APPLE',
                        EAN: '4006381333931',
                        isActive: false,
                    },
                ],
            }),
            updateOne: jest.fn(),
        };
        const connection = { db: { collection: jest.fn(() => products) } };
        expect(await findInvalidProductNames(connection as never)).toEqual([
            {
                id: B.toString(),
                name: 'QA 🍎 APPLE',
                EAN: '4006381333931',
                isActive: false,
                label: '4006381333931 – QA 🍎 APPLE (archived)',
            },
        ]);
        expect(products.updateOne).not.toHaveBeenCalled();
    });
});
