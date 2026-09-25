import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetAllDto } from './inventory.dto';

/** As the ValidationPipe converts a query string. */
function fromQuery(query: Record<string, unknown>) {
    return plainToInstance(
        GetAllDto,
        { page: '1', limit: '5', ...query },
        { enableImplicitConversion: true },
    );
}

async function maxStockErrors(maxStock: unknown) {
    const errors = await validate(fromQuery({ maxStock }));
    return errors.filter((e) => e.property === 'maxStock');
}

describe('GetAllDto.maxStock (issue #14)', () => {
    it('accepts 0, "out of stock", from a query string', async () => {
        const dto = fromQuery({ maxStock: '0' });

        expect(dto.maxStock).toBe(0);
        expect(await maxStockErrors('0')).toHaveLength(0);
    });

    it('accepts a positive whole number', async () => {
        expect(await maxStockErrors('5')).toHaveLength(0);
    });

    it('rejects a negative threshold', async () => {
        const [error] = await maxStockErrors('-1');

        expect(error?.constraints).toHaveProperty('min');
    });

    it('rejects a fraction', async () => {
        const [error] = await maxStockErrors('1.5');

        expect(error?.constraints).toHaveProperty('isInt');
    });

    it('is optional', async () => {
        expect(await validate(fromQuery({}))).toHaveLength(0);
    });
});

describe('GetAllDto search', () => {
    it('lowercases and trims the name, as names are stored', () => {
        // The inventory screen sends the name upper-cased.
        expect(fromQuery({ name: '  FRESH MILK ' }).name).toBe('fresh milk');
    });

    it('trims the barcode prefix', () => {
        expect(fromQuery({ EAN: ' 480 ' }).EAN).toBe('480');
    });
});
