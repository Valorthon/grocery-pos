/**
 * Runtime key lists for the wire types (issue #27), so a spec can check a
 * real response against its contract type.
 *
 * A `WireShape<T>` names every key of `T`, and no other, as `'required'`
 * or `'optional'`. The compiler enforces both directions: a key missing
 * from the shape, a key the type does not have, or the wrong marker is a
 * type error. So the shape cannot drift from the type, and a spec that
 * compares a response with the shape (`wireShapeDiff`) compares it with
 * the type.
 */
export type WireShape<T> = {
    readonly [K in keyof T]-?: object extends Pick<T, K>
        ? 'optional'
        : 'required';
};

/**
 * Keys Mongoose adds to every document it returns that no contract names:
 * the version key of a `.lean()` read. Never read by the client.
 */
export const MONGOOSE_INTERNAL_KEYS: readonly string[] = ['__v'];

/** How a value's own keys differ from a wire shape. Empty lists: a match. */
export interface WireShapeDiff {
    /** Required keys of the shape that the value lacks. */
    missing: string[];
    /** Keys of the value the shape does not name. */
    unexpected: string[];
}

/**
 * Compares `value`'s own keys with `shape`. Keys in `ignore` (by default
 * Mongoose's `__v`) are never unexpected. A value that is not a plain
 * object misses every required key.
 */
export function wireShapeDiff<T>(
    value: unknown,
    shape: WireShape<T>,
    ignore: readonly string[] = MONGOOSE_INTERNAL_KEYS,
): WireShapeDiff {
    const entries = Object.entries(shape) as [string, string][];
    const isObject =
        typeof value === 'object' && value !== null && !Array.isArray(value);
    const keys = isObject ? Object.keys(value) : [];
    const known = new Set(entries.map(([key]) => key));

    return {
        missing: entries
            .filter(([key, need]) => need === 'required' && !keys.includes(key))
            .map(([key]) => key)
            .sort(),
        unexpected: keys
            .filter((key) => !known.has(key) && !ignore.includes(key))
            .sort(),
    };
}
