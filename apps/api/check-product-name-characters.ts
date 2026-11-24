import 'dotenv/config';
import mongoose from 'mongoose';
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
        console.table(invalid);
        console.error(
            `${invalid.length} product name(s) use characters that are no longer allowed. Rename them in Products (allowed: letters, numbers, spaces and . , - & ' / ( ) %).`,
        );
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}
void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
