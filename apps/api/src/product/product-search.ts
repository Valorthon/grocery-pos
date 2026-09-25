import { containsRegex, prefixRegex } from '../common/utils/regex';

/**
 * The product list's search (issue #14): `name` anywhere in the name,
 * `EAN` as a barcode prefix. `prefix` is the path of the product document,
 * e.g. `product.` after a `$lookup`, so the inventory list searches exactly
 * as the product list does.
 */
export function productSearchFilter(
    { name, EAN }: { name?: string; EAN?: string },
    prefix = '',
): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (name) filter[`${prefix}name`] = containsRegex(name);
    if (EAN) filter[`${prefix}EAN`] = prefixRegex(EAN);
    return filter;
}
