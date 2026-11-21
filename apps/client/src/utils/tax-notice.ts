/**
 * Owner decision 2026-11-21 (#418): the app records non-VAT totals and does
 * no tax math. VAT, SC/PWD discounts and BIR receipts stay with the store's
 * own receipts (#48).
 */
export const NON_VAT_NOTICE =
    'Totals include no VAT breakdown. VAT, SC/PWD and BIR receipts are handled outside this app.';
