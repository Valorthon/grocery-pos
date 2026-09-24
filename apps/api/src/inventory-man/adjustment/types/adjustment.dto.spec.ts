import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdjustFields } from './adjustment.dto';

async function changeErrors(change: unknown) {
    const dto = plainToInstance(AdjustFields, {
        product: '507f1f77bcf86cd799439011',
        change,
        reason: 'recount',
    });
    const errors = await validate(dto);
    return errors.filter((e) => e.property === 'change');
}

describe('AdjustFields.change', () => {
    it('accepts a whole-number change in either direction', async () => {
        expect(await changeErrors(5)).toHaveLength(0);
        expect(await changeErrors(-5)).toHaveLength(0);
    });

    it('rejects a fractional change', async () => {
        const [error] = await changeErrors(1.5);

        expect(error?.constraints).toHaveProperty('isInt');
    });

    it('rejects a zero change', async () => {
        const [error] = await changeErrors(0);

        expect(error?.constraints).toHaveProperty('notEquals');
    });
});
