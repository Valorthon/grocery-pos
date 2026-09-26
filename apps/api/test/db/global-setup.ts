import mongoose from 'mongoose';

/**
 * Fails the run up front, with a clear message, when MONGO_URI_TEST is not
 * set or does not reach a replica set. Skipping silently would let a CI job
 * report success without testing anything.
 */
export default async function globalSetup(): Promise<void> {
    const uri = process.env.MONGO_URI_TEST;
    if (!uri) {
        throw new Error(
            'MONGO_URI_TEST is not set. The DB suite needs a MongoDB replica set, e.g. ' +
                'MONGO_URI_TEST="mongodb://127.0.0.1:27017/?directConnection=true" ' +
                'with the repo-root docker compose MongoDB running (see README).',
        );
    }

    const conn = await mongoose
        .createConnection(uri, { serverSelectionTimeoutMS: 10_000 })
        .asPromise();
    try {
        const hello = (await conn.db!.admin().command({ hello: 1 })) as {
            setName?: string;
        };
        if (!hello.setName) {
            throw new Error(
                `MONGO_URI_TEST (${uri}) is not a replica set member: transactions need one (mongod --replSet rs0).`,
            );
        }
    } finally {
        await conn.close();
    }
}
