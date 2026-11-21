/**
 * Owner decision 2026-11-21 (#418): the app records non-VAT totals and does
 * no tax math. VAT, SC/PWD discounts and BIR receipts stay with the store's
 * own receipts (#48).
 */
export const NON_VAT_NOTICE =
    'Totals are non-VAT; this app computes no tax. VAT, SC/PWD discounts and BIR receipts are handled outside this app.';
