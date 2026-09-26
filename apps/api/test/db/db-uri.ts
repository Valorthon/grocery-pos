/** Every throwaway database starts with this, and only those are dropped. */
export const DB_PREFIX = 'gpos_dbtest_';

/** A MongoDB URI with its database path replaced by `dbName`. */
export function uriWithDb(uri: string, dbName: string): string {
    const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(
        uri,
    );
    if (!match) throw new Error(`Unrecognised MONGO_URI_TEST: ${uri}`);
    return `${match[1]}/${dbName}${match[2] ?? ''}`;
}
