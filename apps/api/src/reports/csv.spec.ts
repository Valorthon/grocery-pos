import { csvCell, csvMoney, csvRow } from './csv';

describe('spreadsheet-safe CSV', () => {
    it.each([
        '=1+1',
        '+SUM(A1)',
        '-1+1',
        '@SUM(A1)',
        '\t =1',
        '\r\n+1',
        '\u0000=1',
    ])('neutralizes formula text %j', (text) =>
        expect(csvCell(text)).toBe(`"'${text}"`),
    );
    it('escapes quotes and preserves cell newlines', () => {
        expect(csvRow(['milk,"fresh"\r\nlarge', -123, 'Frozen'])).toBe(
            '"milk,""fresh""\r\nlarge",-123,"Frozen"\r\n',
        );
    });
    it.each([NaN, Infinity, -Infinity])('rejects nonfinite number %s', (n) => {
        expect(() => csvCell(n)).toThrow(RangeError);
    });
    it.each([
        [0, '0.00'],
        [1, '0.01'],
        [8100, '81.00'],
        [-101, '-1.01'],
        [Number.MAX_SAFE_INTEGER, '90071992547409.91'],
    ])('formats centavos exactly', (n, result) =>
        expect(csvMoney(Number(n))).toBe(result),
    );
    it.each([1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid centavos',
        (n) => {
            expect(() => csvMoney(n)).toThrow(RangeError);
        },
    );
});
