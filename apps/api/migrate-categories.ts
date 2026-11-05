import 'dotenv/config';
import mongoose from 'mongoose';
import { migrateCategories } from './src/migrations/categories';
import { describeDatabase } from './src/common/utils/seed-guard';
async function main() {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--apply'))
        throw new Error('Usage: migrate:categories [--apply]');
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    console.log(
        `${args.includes('--apply') ? 'APPLY' : 'DRY RUN'} categories: ${describeDatabase(url)}`,
    );
    await mongoose.connect(url);
    try {
        console.table(
            await migrateCategories(
                mongoose.connection,
                args.includes('--apply'),
            ),
        );
    } finally {
        await mongoose.disconnect();
    }
}
void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
