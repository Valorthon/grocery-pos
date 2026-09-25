/**
 * One-off migration for issue #15: decodes the HTML entities (`&amp;`,
 * `&lt;`, `&gt;`, `&quot;`) that the removed SanitationPipe wrote into
 * stored text. Run it once, at the deploy that ships the fix (see the
 * README's deploy notes):
 *
 *   pnpm migrate:decode-entities            # dry run: report only
 *   pnpm migrate:decode-entities --apply    # write the changes
 *
 * It reads DATABASE_URL, as `pnpm seed` does. The logic, and its tests,
 * live in src/migrations/decode-html-entities.ts; this file only connects.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { User, UserSchema } from './src/user/user.schema';
import { Product, ProductSchema } from './src/product/product.schema';
import {
    Restock,
    RestockSchema,
} from './src/inventory-man/restock/restock.schema';
import {
    Adjustment,
    AdjustmentSchema,
} from './src/inventory-man/adjustment/adjustment.schema';
import {
    AdjustmentDetails,
    AdjustmentDetailsSchema,
} from './src/inventory-man/adjustment/adjustment-details.schema';
import { Sales, SalesSchema } from './src/sales/sales.schema';
import { Shift, ShiftSchema } from './src/shift/shift.schema';
import { describeDatabase } from './src/common/utils/seed-guard';
import {
    MigrationMarker,
    ProgressRecord,
    runMigration,
} from './src/migrations/decode-html-entities';

const APPLY_FLAG = '--apply';

/** Target model name -> its collection, as Mongoose names it. */
const COLLECTIONS: Record<string, string> = Object.fromEntries(
    [
        mongoose.model(Product.name, ProductSchema),
        mongoose.model(User.name, UserSchema),
        mongoose.model(Restock.name, RestockSchema),
        mongoose.model(Adjustment.name, AdjustmentSchema),
        mongoose.model(AdjustmentDetails.name, AdjustmentDetailsSchema),
        mongoose.model(Sales.name, SalesSchema),
        mongoose.model(Shift.name, ShiftSchema),
    ].map((model) => [model.modelName, model.collection.collectionName]),
);

async function main(): Promise<number> {
    const apply = process.argv.slice(2).includes(APPLY_FLAG);
    const databaseUrl =
        process.env.DATABASE_URL ?? 'mongodb://127.0.0.1:27017/grocery';

    console.log(
        `${apply ? 'APPLYING' : `DRY RUN (pass ${APPLY_FLAG} to write)`}: ` +
            `decode HTML entities (#15) in ${describeDatabase(databaseUrl)}`,
    );
    await mongoose.connect(databaseUrl);
    const db = mongoose.connection.db;
    if (!db) throw new Error('Not connected');

    const outcome = await runMigration({
        apply,
        // The native driver collections: no schema casting, validation or
        // hooks, just the fields named in the update.
        collectionFor: (model) => {
            const name = COLLECTIONS[model];
            if (!name) throw new Error(`No model registered for ${model}`);
            return db.collection(name);
        },
        migrations: db.collection<MigrationMarker>('migrations'),
        progress: db.collection<ProgressRecord>('migration_progress'),
        runId: new mongoose.Types.ObjectId().toString(),
    });

    for (const line of outcome.lines) console.log(line);
    return outcome.exitCode;
}

main()
    .then(async (code) => {
        await mongoose.disconnect();
        process.exit(code);
    })
    .catch(async (err) => {
        console.error('Migration failed: ', err);
        await mongoose.disconnect().catch(() => undefined);
        process.exit(1);
    });
