import {
    formatQuantity,
    insufficientStockText,
    type AppErrorResponse,
    type InsufficientStockLine,
    type UnitOfMeasure,
} from '@grocery-pos/contracts';

/**
 * The register's non-blocking warning when a line asks for more than the
 * stock the lookup reported (#422), or null when there is enough. The line
 * is added anyway: stock can change before checkout, which stays the check.
 */
export function stockWarningText(
    name: string,
    quantity: number,
    stock: number,
    unit?: UnitOfMeasure,
): string | null {
    if (quantity <= stock) return null;
    return `Only ${formatQuantity(Math.max(0, stock), unit)} of ${name} in stock. Checkout may refuse this line.`;
}

function isShortLine(value: unknown): value is InsufficientStockLine {
    if (typeof value !== 'object' || value === null) return false;
    const line = value as Record<string, unknown>;
    return (
        typeof line.product === 'string' &&
        Number.isSafeInteger(line.requested) &&
        Number.isSafeInteger(line.available)
    );
}

/**
 * The short products an insufficient-stock refusal names in its `details`,
 * worded in display units, or null when the body names none (#422).
 */
export function shortStockText(
    body: Partial<AppErrorResponse> | undefined,
): string | null {
    const lines = shortStockLines(body);
    return lines.length ? insufficientStockText(lines) : null;
}

/**
 * The well-formed short lines an insufficient-stock refusal names in its
 * `details` (#422), or none. The register updates their stock hints (#504).
 */
export function shortStockLines(
    body: Partial<AppErrorResponse> | undefined,
): InsufficientStockLine[] {
    const details: unknown = body?.details;
    return Array.isArray(details) ? details.filter(isShortLine) : [];
}
