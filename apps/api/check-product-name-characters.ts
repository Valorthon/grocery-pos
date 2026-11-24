import 'dotenv/config';
import mongoose from 'mongoose';
import { INVALID_PRODUCT_NAME_STEPS } from '@grocery-pos/contracts';
import { findInvalidProductNames } from './src/migrations/product-name-characters';
import { describeDatabase } from './src/common/utils/seed-guard';
async function main() {
    if (process.argv.length > 2)
        throw new Error('Usage: check:product-name-characters');
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    console.log(
        `CHECK product name characters (read-only): ${describeDatabase(url)}`,
    );
    await mongoose.connect(url);
    try {
        const invalid = await findInvalidProductNames(mongoose.connection);
        if (invalid.length === 0) {
            console.log('Every product name uses only allowed characters.');
            return;
        }
        // Active names must be fixed (exit 1); archived ones only warn.
        const active = invalid.filter((row) => row.isActive !== false);
        const archived = invalid.filter((row) => row.isActive === false);
        if (active.length) {
            console.error(
                `${active.length} active product name(s) use characters that are no longer allowed:`,
            );
            for (const row of active) console.error(`  ${row.label}`);
        }
        if (archived.length) {
            console.warn(
                `warning: ${archived.length} archived product name(s) use characters that are no longer allowed:`,
            );
            for (const row of archived) console.warn(`  ${row.label}`);
        }
        console.error(INVALID_PRODUCT_NAME_STEPS);
        if (active.length) process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}
void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
