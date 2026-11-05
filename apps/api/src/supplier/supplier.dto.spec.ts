import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SUPPLIER_LIMITS } from '@grocery-pos/contracts';
import {
    SupplierFieldsDto,
    UpdateSupplierDto,
    SupplierQueryDto,
    ProductCostsDto,
} from './supplier.dto';

describe('supplier request boundaries', () => {
    it('trims contact fields while preserving phone and TIN formatting', () => {
        const dto = plainToInstance(SupplierFieldsDto, {
            name: '  Fresh Farm  ',
            contactPerson: '  Ana  ',
            phone: ' +63 917-000-0000 ',
            email: ' ana@example.com ',
            address: '  Manila  ',
            TIN: '  000-123-456  ',
        });
        expect(validateSync(dto)).toEqual([]);
        expect(dto).toMatchObject({
            name: 'Fresh Farm',
            contactPerson: 'Ana',
            phone: '+63 917-000-0000',
            email: 'ana@example.com',
            address: 'Manila',
            TIN: '000-123-456',
        });
    });
    it.each([
        { name: '' },
        { name: '   ' },
        { name: null },
        { name: 'x'.repeat(SUPPLIER_LIMITS.NAME + 1) },
        { name: 'Farm', email: 'invalid' },
        { name: 'Farm', email: null },
        { name: 'Farm', phone: null },
        { name: 'Farm', TIN: 123 },
        { name: 'Farm', address: 'x'.repeat(SUPPLIER_LIMITS.ADDRESS + 1) },
    ])('rejects invalid supplier input %j', (value) => {
        expect(
            validateSync(plainToInstance(SupplierFieldsDto, value)).length,
        ).toBeGreaterThan(0);
    });
    it.each([
        {},
        { name: null },
        { isActive: null },
        { isActive: 'true' },
        { email: null },
    ])('rejects empty or malformed patches %j', (value) => {
        expect(
            validateSync(plainToInstance(UpdateSupplierDto, value)).length,
        ).toBeGreaterThan(0);
    });
    it('allows an archive-only patch and bounds paginated lookups', () => {
        expect(
            validateSync(
                plainToInstance(UpdateSupplierDto, { isActive: false }),
            ),
        ).toEqual([]);
        expect(
            validateSync(
                plainToInstance(SupplierQueryDto, {
                    page: '1',
                    limit: '100',
                    status: 'archived',
                }),
            ),
        ).toEqual([]);
        expect(
            validateSync(
                plainToInstance(SupplierQueryDto, { page: '0', limit: '101' }),
            ).length,
        ).toBeGreaterThan(0);
    });
});

describe('procurement cost lookup limits', () => {
    const id = '507f1f77bcf86cd799439011';
    it.each([id, [id]])('accepts explicit ids in query form %j', (products) => {
        const dto = plainToInstance(ProductCostsDto, { products });
        expect(validateSync(dto)).toEqual([]);
        expect(dto.products).toEqual([id]);
    });
    it.each([
        undefined,
        null,
        [],
        ['invalid'],
        Array.from({ length: 201 }, () => id),
    ])('rejects malformed or oversized lookup %j', (products) => {
        expect(
            validateSync(plainToInstance(ProductCostsDto, { products })).length,
        ).toBeGreaterThan(0);
    });
});
