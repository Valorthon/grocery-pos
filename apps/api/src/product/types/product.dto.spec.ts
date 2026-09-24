import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NewProductFields } from './product.dto';

async function priceErrors(price: unknown) {
    const dto = plainToInstance(NewProductFields, { name: 'bread', price });
    const errors = await validate(dto);
    return errors.filter((e) => e.property === 'price');
}

describe('NewProductFields.price', () => {
    it('accepts a whole number of centavos', async () => {
        expect(await priceErrors(1999)).toHaveLength(0);
    });

    it('rejects fractional money, which would be pesos or a float artifact', async () => {
        const [error] = await priceErrors(19.99);

        expect(error?.constraints).toHaveProperty('isInt');
    });

    it('rejects a free product', async () => {
        const [error] = await priceErrors(0);

        expect(error?.constraints).toHaveProperty('min');
    });
});
