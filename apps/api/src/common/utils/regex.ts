/** Escapes user input so it matches literally inside a `$regex`. */
export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A `$regex` matching `term` anywhere in the field, literally. Product
 * names are searched this way (issue #14): names are stored lowercase and
 * the search DTOs lowercase the term, so the match is case-insensitive.
 */
export function containsRegex(term: string): { $regex: string } {
    return { $regex: escapeRegex(term) };
}

/**
 * A `$regex` matching fields that start with `term`, literally. Barcodes
 * are searched this way: a scanner or a typed code fills from the left.
 */
export function prefixRegex(term: string): { $regex: string } {
    return { $regex: `^${escapeRegex(term)}` };
}
