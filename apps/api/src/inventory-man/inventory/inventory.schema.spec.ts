import { InventorySchema } from './inventory.schema';

describe('Inventory indexes (issue #16)', () => {
    it('indexes stock for the dashboard tiles and the maxStock filter', () => {
        expect(InventorySchema.indexes().map(([keys]) => keys)).toContainEqual({
            stock: 1,
        });
    });
});
