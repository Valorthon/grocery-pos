/** Text cells are always quoted and neutralize spreadsheet formulas. */
export function csvCell(value: string | number): string {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new RangeError('Invalid CSV number');
        return String(value);
    }
    let first = 0;
    while (
        first < value.length &&
        (value.charCodeAt(first) <= 0x1f || /\s/u.test(value[first]))
    ) {
        first += 1;
    }
    const formula = first < value.length && '=+-@'.includes(value[first]);
    const safe = formula ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
}

export function csvRow(values: readonly (string | number)[]): string {
    return `${values.map(csvCell).join(',')}\r\n`;
}

/** Exact centavos to plain decimal pesos, without locale separators. */
export function csvMoney(centavos: number): string {
    if (!Number.isSafeInteger(centavos)) {
        throw new RangeError('Invalid CSV centavos');
    }
    const absolute = Math.abs(centavos);
    return `${centavos < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
