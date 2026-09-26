/**
 * `n` with the noun in the right number: "1 line", "2 lines", "0 items".
 * The plural defaults to the singular plus "s".
 */
export function countOf(
    n: number,
    singular: string,
    plural = `${singular}s`,
): string {
    return `${n} ${n === 1 ? singular : plural}`;
}
