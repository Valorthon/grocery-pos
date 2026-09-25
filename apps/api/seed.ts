import 'dotenv/config';
import mongoose from 'mongoose';
import { ASSIGNABLE_ROLES } from '@grocery-pos/contracts';
import { Role } from './src/auth/types/auth.types';
import { User, UserSchema } from './src/user/user.schema';
import * as argon from 'argon2';
import { randomInt } from 'crypto';
import { Product, ProductSchema } from './src/product/product.schema';
import {
    Inventory,
    InventorySchema,
} from './src/inventory-man/inventory/inventory.schema';
import {
    Restock,
    RestockSchema,
} from './src/inventory-man/restock/restock.schema';
import {
    RestockDetails,
    RestockDetailsSchema,
} from './src/inventory-man/restock/restock-details.schema';
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
import {
    SalesDetails,
    SalesDetailsSchema,
} from './src/sales/sales-details.schema';
import {
    RefreshToken,
    RefreshTokenSchema,
} from './src/auth/refresh-token/refresh-token.schema';
import { Category } from './src/product/types';
import {
    assertSeedAllowed,
    describeDatabase,
} from './src/common/utils/seed-guard';

/**
 * Every seeded user's password. Development data only; it meets the
 * password policy (STRING_LIMITS.PASSWORD_MIN) so accounts can be edited
 * from the app without tripping it.
 */
const SEED_PASSWORD = 'password123';

const user = mongoose.model(User.name, UserSchema);
const product = mongoose.model(Product.name, ProductSchema);
const inventory = mongoose.model(Inventory.name, InventorySchema);
const restock = mongoose.model(Restock.name, RestockSchema);
const refreshToken = mongoose.model(RefreshToken.name, RefreshTokenSchema);
const restockDetails = mongoose.model(
    RestockDetails.name,
    RestockDetailsSchema,
);
const adjustment = mongoose.model(Adjustment.name, AdjustmentSchema);
const adjustmentDetails = mongoose.model(
    AdjustmentDetails.name,
    AdjustmentDetailsSchema,
);
const sales = mongoose.model(Sales.name, SalesSchema);
const salesDetails = mongoose.model(SalesDetails.name, SalesDetailsSchema);
const shift = mongoose.model(Shift.name, ShiftSchema);

seedAll()
    .then(() => {
        console.log('Seeding complete...');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Error in seeding: ', err);
        process.exit(1);
    });

/** Drops a collection, tolerating the case where it was never created. */
async function dropIfExists(model: { collection: mongoose.Collection }) {
    try {
        await model.collection.drop();
    } catch (err) {
        const code = (err as { codeName?: string; code?: number }).codeName;
        if (code === 'NamespaceNotFound') return;
        throw err;
    }
}

async function seedAll() {
    assertSeedAllowed(process.env.NODE_ENV, process.argv.slice(2));

    const databaseUrl =
        process.env.DATABASE_URL ?? 'mongodb://127.0.0.1:27017/grocery';
    console.log(
        `Seeding DROPS every collection of ${describeDatabase(databaseUrl)} ` +
            `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'}).`,
    );
    await mongoose.connect(databaseUrl);
    console.log(
        `Connected to ${mongoose.connection.host}, database ` +
            `'${mongoose.connection.name}'. Wiping it now.`,
    );

    await Promise.all([
        seedUser(),
        seedProduct(),
        dropIfExists(restock),
        dropIfExists(restockDetails),
        dropIfExists(adjustment),
        dropIfExists(adjustmentDetails),
        dropIfExists(sales),
        dropIfExists(salesDetails),
        dropIfExists(shift),
        dropIfExists(refreshToken),
    ]);

    //must run after seedProduct()
    await seedInventory();
    await seedRestock();
    await seedAdjustment();
    await mongoose.disconnect();
}

async function seedUser() {
    const hash = await argon.hash(SEED_PASSWORD);

    // Only storable roles: UNAUTHENTICATED fails the schema enum, and the
    // collection is already dropped by then, leaving no users at all.
    const keys = (Object.keys(Role) as Array<keyof typeof Role>).filter((key) =>
        ASSIGNABLE_ROLES.includes(Role[key]),
    );

    let users: { name: string; passwordHash: string; roles: Role[] }[] =
        keys.map((key) => ({
            name: key,
            passwordHash: hash,
            roles: [Role[key]],
        }));

    const inactives = keys.map((key) => ({
        name: key + '1',
        passwordHash: hash,
        roles: [Role[key]],
        isActive: false,
    }));

    users = users.concat(inactives);

    console.log(users);
    await user.collection.drop();
    return await user.insertMany(users);
}

async function seedProduct() {
    const productData = [
        { name: 'BREAD', category: Category.FOOD },
        { name: 'APPLES', category: Category.FOOD },
        { name: 'RICE', category: Category.FOOD },
        { name: 'PASTA', category: Category.FOOD },

        { name: 'COFFEE', category: Category.DRINKS },
        { name: 'WATER', category: Category.DRINKS },
        { name: 'ORANGE_JUICE', category: Category.DRINKS },
        { name: 'MILK', category: Category.DRINKS },

        { name: 'HEADPHONES', category: Category.ELECTRONICS },
        { name: 'SMARTPHONE', category: Category.ELECTRONICS },
        { name: 'CHARGING_CABLE', category: Category.ELECTRONICS },
        { name: 'POWER_BANK', category: Category.ELECTRONICS },

        { name: 'PAPER_TOWELS', category: Category.HOUSEHOLD },
        { name: 'DISH_SOAP', category: Category.HOUSEHOLD },
        { name: 'BIBLE', category: Category.HOUSEHOLD },
        { name: 'LAUNDRY_DETERGENT', category: Category.HOUSEHOLD },

        { name: 'COTTON_TSHIRT', category: Category.CLOTHES },
        { name: 'DENIM_JEANS', category: Category.CLOTHES },
        { name: 'WINTER_JACKET', category: Category.CLOTHES },
        { name: 'ANKLE_SOCKS', category: Category.CLOTHES },
    ];

    let currentEAN = 10000000;

    const products = productData.map((item) => ({
        EAN: (currentEAN++).toString(),
        name: item.name,
        category: item.category,
        price: randomInt(1_000, 100_000), // centavos: ₱10.00 to ₱999.99
    }));

    console.log(products);
    await product.collection.drop();
    return await product.insertMany(products);
}

async function seedInventory() {
    const [users, products] = await Promise.all([
        user.find({ roles: Role.Admin }).lean(),
        product.find().lean(),
    ]);

    const usersLen = users.length;

    const inventories = products.map((prod, idx) => ({
        product: prod._id,
        stock: randomInt(0, 500),
        updatedBy: users[idx % usersLen]._id,
    }));

    console.log(inventories);
    await inventory.collection.drop();
    await inventory.insertMany(inventories);
}

async function seedRestock() {
    // 1. Fetch available users and products to reference
    const [users, products] = await Promise.all([
        user.find().lean(),
        product.find().lean(),
    ]);

    if (!users.length || !products.length) {
        console.log('Users or Products missing. Cannot seed Restocks.');
        return;
    }

    const restocksToInsert: Restock[] = [];
    const restockDetailsToInsert: RestockDetails[] = [];

    // 2. Generate 5 random Restock batches
    for (let i = 0; i < 5; i++) {
        // Generate an ID up front so we can link the details to it
        const restockId = new mongoose.Types.ObjectId();
        const restockedBy = users[randomInt(0, users.length)]._id;

        let totalCost = 0;

        // Pick 2 to 5 random items for this specific restock batch
        const numItems = randomInt(2, 6);

        for (let j = 0; j < numItems; j++) {
            const randomProduct = products[randomInt(0, products.length)];
            const quantity = randomInt(10, 100);
            const unitCost = randomInt(500, 5_000); // centavos: ₱5.00 to ₱49.99

            totalCost += quantity * unitCost;

            restockDetailsToInsert.push({
                restock: restockId,
                product: randomProduct._id,
                quantity,
                unitCost,
            });
        }

        // 3. Create the parent Restock document now that we have the totalCost
        restocksToInsert.push({
            _id: restockId,
            description: `Monthly Restock Batch #${i + 1}`,
            restockedBy: restockedBy,
            totalCost: totalCost,
        } as Restock);
    }

    console.log(
        `Prepared ${restocksToInsert.length} restocks and ${restockDetailsToInsert.length} restock details.`,
    );

    // 4. Insert into the database
    await restock.insertMany(restocksToInsert);
    await restockDetails.insertMany(restockDetailsToInsert);
}

async function seedAdjustment() {
    // 1. Fetch available users and products
    const [users, products] = await Promise.all([
        user.find().lean(),
        product.find().lean(),
    ]);

    if (!users.length || !products.length) {
        console.log('Users or Products missing. Cannot seed Adjustments.');
        return;
    }

    const adjustmentsToInsert: Adjustment[] = [];
    const adjustmentDetailsToInsert: AdjustmentDetails[] = [];

    const reasons = [
        'Damaged goods',
        'Expired product',
        'Counting error',
        'Theft',
        'Promotional giveaway',
    ];

    // 2. Generate 5 random Adjustment batches
    for (let i = 0; i < 5; i++) {
        const adjustmentId = new mongoose.Types.ObjectId();
        const adjustedBy = users[randomInt(0, users.length)]._id;

        // Create the parent Adjustment document
        adjustmentsToInsert.push({
            _id: adjustmentId,
            description: `Routine Inventory Audit #${i + 1}`,
            adjustedBy: adjustedBy,
        } as Adjustment);

        // Pick 2 to 4 random items to adjust for this batch
        const numItems = randomInt(2, 5);

        for (let j = 0; j < numItems; j++) {
            const randomProduct = products[randomInt(0, products.length)];

            // Generate a non-zero random integer between -10 and 10
            let change = randomInt(-10, 11);
            if (change === 0) change = -1; // Fallback to ensure it passes your validation

            const reason = reasons[randomInt(0, reasons.length)];

            adjustmentDetailsToInsert.push({
                adjustment: adjustmentId,
                product: randomProduct._id,
                change,
                reason,
            });
        }
    }

    console.log(
        `Prepared ${adjustmentsToInsert.length} adjustments and ${adjustmentDetailsToInsert.length} adjustment details.`,
    );

    // 3. Insert into the database
    await adjustment.insertMany(adjustmentsToInsert);
    await adjustmentDetails.insertMany(adjustmentDetailsToInsert);
}
