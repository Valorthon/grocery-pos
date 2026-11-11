/**
 * The count id behind an adjustment posted by a stock count approval
 * (#43): the API writes the description and each line's reason as
 * `stock count <24-hex id>`. Null for any other text.
 */
export function stockCountId(text: string | undefined): string | null {
    const match = /^stock count ([0-9a-f]{24})$/i.exec(text?.trim() ?? '');
    return match ? match[1] : null;
}

/** "Stock count 1A2B3C4D" (last 8 of the id, #260), else the text as is. */
export function stockCountLabel(text: string): string {
    const id = stockCountId(text);
    return id ? `Stock count ${id.slice(-8).toUpperCase()}` : text;
}
