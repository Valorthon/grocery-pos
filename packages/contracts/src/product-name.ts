/**
 * Product names are stored and shown in UPPERCASE (#443, owner decision
 * 2026-11-22): trimmed, then uppercased. Uniqueness and name search key on
 * this form, so a search is case-insensitive whatever the user types.
 */
export function normalizeProductName(name: string): string {
    return name.trim().toUpperCase();
}

export interface ProductNameRow {
    id: string;
    name: string;
}

export interface ProductNamePlan {
    /** Rows whose stored name differs from its normalized form. */
    updates: { id: string; from: string; to: string }[];
    /** Normalized names two or more products would share. */
    collisions: { name: string; ids: string[] }[];
    /** Rows whose normalized name would exceed `maxLength`. */
    tooLong: { id: string; to: string }[];
}

/**
 * Plans the one-off uppercase migration (#443) from every product's id and
 * stored name. Nothing may be written while `collisions` or `tooLong` is
 * non-empty; an already-migrated set plans no updates (idempotent).
 */
export function planProductNameUppercase(
    rows: readonly ProductNameRow[],
    maxLength: number,
): ProductNamePlan {
    const byName = new Map<string, string[]>();
    const updates: ProductNamePlan['updates'] = [];
    const tooLong: ProductNamePlan['tooLong'] = [];
    for (const { id, name } of rows) {
        const to = normalizeProductName(name);
        byName.set(to, [...(byName.get(to) ?? []), id]);
        if (to.length > maxLength) tooLong.push({ id, to });
        if (to !== name) updates.push({ id, from: name, to });
    }
    const collisions = [...byName]
        .filter(([, ids]) => ids.length > 1)
        .map(([name, ids]) => ({ name, ids }));
    return { updates, collisions, tooLong };
}
