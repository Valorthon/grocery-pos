import { STRING_LIMITS } from '@grocery-pos/contracts';

/**
 * The query for one product search box (#260): a digits-only term of at
 * most `STRING_LIMITS.EAN` digits is a barcode prefix (`EAN`), anything
 * else a name fragment, upper-cased as names are stored. Not `isBarcode`,
 * which needs the full length. A blank term searches nothing.
 */
export function productSearchParams(query: string): {
    EAN?: string;
    name?: string;
} {
    const term = query.trim();
    if (!term) return {};
    return /^\d+$/.test(term) && term.length <= STRING_LIMITS.EAN
        ? { EAN: term }
        : { name: term.toUpperCase() };
}
