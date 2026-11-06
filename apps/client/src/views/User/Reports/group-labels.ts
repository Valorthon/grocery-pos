import { SalesReportGroup } from '@grocery-pos/contracts';

/** What the "Group by" select shows for each value it sends (#143). */
export const GROUP_LABELS: Record<SalesReportGroup, string> = {
    [SalesReportGroup.DAY]: 'Day',
    [SalesReportGroup.PRODUCT]: 'Product',
    [SalesReportGroup.CATEGORY]: 'Category',
    [SalesReportGroup.CASHIER]: 'Cashier',
    [SalesReportGroup.PAYMENT_TYPE]: 'Payment type',
};
