import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// #165: the register's dialogs, receipt, bill count and Z-read use the
// Fresh market tokens only, and big figures use the display face at 800.
const FILES = [
    'CheckoutModal.vue',
    'ReceiptModal.vue',
    'BillCountInput.vue',
    'ZReadReportView.vue',
    'ZReadModal.vue',
    'ShiftInModal.vue',
    'ShiftOutModal.vue',
    'DrawerActionModal.vue',
    'ParkedTicketsDialog.vue',
    'ManagerOverrideDialog.vue',
    'DenominationIcon.vue',
    '../../../views/User/Sales/Sell.vue',
];

const read = (f: string) =>
    readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('register dialogs use design tokens (#165)', () => {
    it.each(FILES)('%s has no raw palette or capped weights', (f) => {
        const src = read(f).replace(/<script[\s\S]*?<\/script>/g, (s) =>
            s.replace(/\/\/.*$/gm, ''),
        );
        expect(src).not.toMatch(
            /\b(slate|gray|emerald|amber|rose|red|primary|blue)-\d{2,3}\b/,
        );
        expect(src).not.toMatch(/\bfont-(black|extrabold)\b/);
        expect(src).not.toMatch(/\brounded-(lg|xl|2xl)\b/);
        expect(src).not.toMatch(/\bfont-mono\b/);
        expect(src).not.toMatch(/bg-white\b/);
    });

    it('big figures use the display face at 800 with tabular digits', () => {
        for (const f of [
            'CheckoutModal.vue',
            'ShiftInModal.vue',
            'ShiftOutModal.vue',
        ]) {
            expect(read(f)).toMatch(/font-display num font-\[800\]/);
        }
    });
});
