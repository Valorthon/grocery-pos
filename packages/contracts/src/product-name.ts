/**
 * Product names are stored and shown in UPPERCASE (#443, owner decision
 * 2026-11-22): trimmed, then uppercased. Uniqueness and name search key on
 * this form, so a search is case-insensitive whatever the user types.
 * Curly apostrophes (U+2018/U+2019) become `'` and no-break spaces
 * (U+00A0) plain spaces first (#483, owner decision 2026-11-24), so a
 * pasted `Mama’s` is stored as `MAMA'S`.
 */
export function normalizeProductName(name: string): string {
    return name
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\u00A0/g, ' ')
        .trim()
        .toUpperCase();
}

/**
 * Characters a product name may use (#483, owner decision 2026-11-24):
 * letters in any script (ñ and accents included, as letters or combining
 * marks: Mn/Mc only, so no keycap/enclosing marks or variation selectors),
 * digits 0-9, spaces and `. , - & ' / ( ) %`. No emoji or other
 * symbols. Names stored before #483 keep displaying; a rename must pass.
 */
export const PRODUCT_NAME_PATTERN =
    /^(?:(?![\u180B-\u180F\uFE00-\uFE0F\u{E0100}-\u{E01EF}])[\p{L}\p{Mn}\p{Mc}0-9 .,&'/()%-])*$/u;

/** The inline/API message for a name with a character outside the rule. */
export const PRODUCT_NAME_CHARACTERS_MESSAGE =
    "Use only letters, numbers, spaces and . , - & ' / ( ) %";

/** True when every character of `name` is allowed (#483). */
export function hasValidProductNameCharacters(name: string): boolean {
    return PRODUCT_NAME_PATTERN.test(name);
}

/**
 * Stored names that break the #483 character rule, for the cloud report
 * and the single-PC upgrade check; nothing rewrites them. A name is judged
 * in its normalized form: a legacy `Mama’s` passes, because any edit
 * stores it as `MAMA'S` and nothing else about it needs the owner.
 */
export function invalidProductNames<T extends { name: string }>(
    rows: readonly T[],
): T[] {
    return rows.filter(
        ({ name }) =>
            !hasValidProductNameCharacters(normalizeProductName(name)),
    );
}

/** One offending product as the reports list it: `EAN – NAME (archived)`. */
export function describeInvalidProductName(row: {
    EAN?: string;
    name: string;
    isActive?: boolean;
}): string {
    return `${row.EAN ?? '(no barcode)'} – ${row.name}${
        row.isActive === false ? ' (archived)' : ''
    }`;
}

/** What to do about the listed names (cloud report, single-PC preflight). */
export const INVALID_PRODUCT_NAME_STEPS =
    "To fix each one: open Products, set Product status to All, search the barcode, choose Edit, rename it using only letters, numbers, spaces and . , - & ' / ( ) %, and save. Then run this check again.";

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
