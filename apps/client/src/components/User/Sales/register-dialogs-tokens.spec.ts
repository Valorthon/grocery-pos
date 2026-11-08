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

const DARK_LABELS = ['ShiftInModal.vue', 'ShiftOutModal.vue'];

const read = (f: string) =>
    readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('register dialogs use design tokens (#165)', () => {
    it.each(FILES)('%s has no raw palette or capped weights', (f) => {
        const src = read(f).replace(/<script[\s\S]*?<\/script>/g, (s) =>
            s.replace(/\/\/.*$/gm, ''),
        );
        expect(src).not.toMatch(
            /\b(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary)-\d{2,3}\b/,
        );
        expect(src).not.toMatch(/\bfont-(black|extrabold)\b/);
        expect(src).not.toMatch(/\brounded-(sm|md|lg|xl|2xl|3xl)\b/);
        expect(src).not.toMatch(/-\[#/);
        // Light-surface muted text is unreadable on a dark leaf fill.
        // Each static class list and each quoted :class branch on its own.
        const lists = [
            ...[...src.matchAll(/(?<!:)class="([^"]*)"/g)].map((m) => m[1]),
            ...[...src.matchAll(/'([^'\n]*\bbg-[^'\n]*)'/g)].map((m) => m[1]),
        ];
        for (const list of lists) {
            if (/\bbg-leaf-(700|800|900|950)\b/.test(list)) {
                expect(list).not.toMatch(/\btext-muted\b/);
            }
        }
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

    it.each(DARK_LABELS)(
        '%s labels on the dark total card are leaf-200',
        (f) => {
            const src = read(f);
            const card = src.slice(src.indexOf('bg-leaf-800'));
            const end = card.indexOf('</div>\n        </div>');
            expect(card.slice(0, end)).not.toMatch(/\btext-muted\b/);
            expect(card.slice(0, end)).toMatch(/\btext-leaf-200\b/);
        },
    );

    it('the receipt is a narrow, unbordered paper slip', () => {
        const src = read('ReceiptModal.vue');
        const slip = /class="(receipt-paper[^"]*)"/.exec(src)?.[1] ?? '';
        expect(slip).toMatch(/\bmax-w-xs\b/);
        expect(slip).toMatch(/\bmx-auto\b/);
        expect(slip).not.toMatch(/\b(rounded|border)\b/);
        expect(src).toMatch(/border-dashed border-line-strong/);
    });
});
