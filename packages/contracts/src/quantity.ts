import { UnitOfMeasure } from './enums.js';

/** Legacy records without a unit remain pieces, with no data conversion. */
export function unitOf(unit?: UnitOfMeasure): UnitOfMeasure {
    return unit ?? UnitOfMeasure.PIECE;
}

/** One displayed kg/litre is 1000 stored grams/millilitres. */
export function quantityScale(unit?: UnitOfMeasure): number {
    return unit === UnitOfMeasure.KG || unit === UnitOfMeasure.L ? 1000 : 1;
}
export function quantityDecimals(unit?: UnitOfMeasure): number {
    return quantityScale(unit) === 1000 ? 3 : 0;
}
export function unitLabel(unit?: UnitOfMeasure): string {
    return { PIECE: 'pc', KG: 'kg', G: 'g', L: 'L' }[unitOf(unit)];
}
/** Parse typed display quantities exactly; no floating-point multiplication. */
export function parseQuantity(
    value: string | number,
    unit?: UnitOfMeasure,
): number | null {
    const text = String(value).trim();
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) return null;
    const decimals = quantityDecimals(unit);
    const fraction = match[3] ?? '';
    if (fraction.length > decimals) return null;
    const base =
        BigInt(match[2]!) * BigInt(quantityScale(unit)) +
        BigInt(fraction.padEnd(decimals, '0') || '0');
    const signed = match[1] ? -base : base;
    if (
        signed > BigInt(Number.MAX_SAFE_INTEGER) ||
        signed < BigInt(Number.MIN_SAFE_INTEGER)
    )
        return null;
    return Number(signed);
}
export function quantityInput(quantity: number, unit?: UnitOfMeasure): string {
    const scale = quantityScale(unit);
    const sign = quantity < 0 ? '-' : '';
    const absolute = Math.abs(quantity);
    return (
        sign +
        String(Math.floor(absolute / scale)) +
        (scale === 1000 ? '.' + String(absolute % scale).padStart(3, '0') : '')
    );
}
export function formatQuantity(quantity: number, unit?: UnitOfMeasure): string {
    return `${quantityInput(quantity, unit)} ${unitLabel(unit)}`;
}
/** Exact line total in integer centavos, rounded half up once per line. */
export function quantityAmount(
    price: number,
    quantity: number,
    unit?: UnitOfMeasure,
): number {
    if (
        !Number.isSafeInteger(price) ||
        !Number.isSafeInteger(quantity) ||
        price < 0 ||
        quantity < 0
    )
        throw new RangeError('Invalid price or quantity');
    const scale = BigInt(quantityScale(unit));
    const amount = (BigInt(price) * BigInt(quantity) + scale / 2n) / scale;
    if (amount > BigInt(Number.MAX_SAFE_INTEGER))
        throw new RangeError('Line total is too large');
    return Number(amount);
}

export function maxQuantityForAmount(
    amount: number,
    price: number,
    unit?: UnitOfMeasure,
): number {
    const scale = BigInt(quantityScale(unit));
    return Math.min(
        Number.MAX_SAFE_INTEGER,
        Number(
            (BigInt(Math.max(0, amount)) * scale + (scale - 1n) / 2n) /
                BigInt(Math.max(1, price)),
        ),
    );
}

/** Legacy reorder settings are ten displayed units, stored as minor units. */
export function reorderLevelOf(product: {
    unit?: UnitOfMeasure;
    reorderLevel?: number;
}): number {
    return product.reorderLevel ?? 10 * quantityScale(product.unit);
}
export function reorderQuantityOf(product: {
    unit?: UnitOfMeasure;
    reorderQuantity?: number;
}): number {
    return product.reorderQuantity ?? 10 * quantityScale(product.unit);
}
