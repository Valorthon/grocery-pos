import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RestockFields } from './restock.dto';

async function unitCostErrors(unitCost: unknown) {
    const dto = plainToInstance(RestockFields, {
        product: '507f1f77bcf86cd799439011',
        quantity: 3,
        unitCost,
    });
    const errors = await validate(dto);
    return errors.filter((e) => e.property === 'unitCost');
}

describe('RestockFields.unitCost', () => {
    it('accepts a whole number of centavos', async () => {
        expect(await unitCostErrors(1999)).toHaveLength(0);
    });

    it('rejects fractional money', async () => {
        const [error] = await unitCostErrors(19.99);

        expect(error?.constraints).toHaveProperty('isInt');
    });

    it('rejects a zero cost', async () => {
        const [error] = await unitCostErrors(0);

        expect(error?.constraints).toHaveProperty('min');
    });
});
