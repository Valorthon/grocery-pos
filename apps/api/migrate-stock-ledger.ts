import 'dotenv/config';
import mongoose from 'mongoose';
import { migrateStockLedger } from './src/migrations/stock-ledger';
import { describeDatabase } from './src/common/utils/seed-guard';
async function main() {
    const args = process.argv.slice(2);
    if (
        args.some((arg) => !['--apply', '--resume-stale'].includes(arg)) ||
        (args.includes('--resume-stale') && !args.includes('--apply'))
    )
        throw new Error(
            'Usage: migrate:stock-ledger [--apply [--resume-stale]]',
        );
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    console.log(
        `${args.includes('--apply') ? 'APPLY' : 'DRY RUN'} stock ledger: ${describeDatabase(url)}. Keep API stopped until complete.`,
    );
    await mongoose.connect(url);
    try {
        console.table(
            await migrateStockLedger(
                mongoose.connection,
                args.includes('--apply'),
                args.includes('--resume-stale'),
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
