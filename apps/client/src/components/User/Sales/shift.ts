export interface BillCounts {
    [denomination: string]: number;
}

export interface DrawerTransaction {
    id: string;
    type: 'cash_in' | 'cash_drop';
    amount: number;
    reason: string;
    timestamp: string;
}

export interface ShiftRecord {
    id: string;
    cashier: string;
    terminal: string;
    openedAt: string;
    openingFloat: number;
    billCounts: BillCounts;
    drawerTransactions: DrawerTransaction[];
    cashSales: number;
    status: 'active' | 'closed';
}

export interface ZReadReport {
    shiftId: string;
    cashier: string;
    terminal: string;
    openedAt: string;
    closedAt: string;
    openingFloat: number;
    totalCashIn: number;
    totalCashDrop: number;
    cashSales: number;
    expectedCash: number;
    actualCash: number;
    overShort: number;
}

export interface BillDenomination {
    id: string;
    value: number;
    label: string;
}

export const PAPER_DENOMINATIONS: BillDenomination[] = [
    { id: '1000', value: 1000, label: '₱1,000' },
    { id: '500', value: 500, label: '₱500' },
    { id: '200', value: 200, label: '₱200' },
    { id: '100', value: 100, label: '₱100' },
    { id: '50', value: 50, label: '₱50' },
    { id: '20', value: 20, label: '₱20' },
];

export const COIN_DENOMINATIONS: BillDenomination[] = [
    { id: 'coin-20', value: 20, label: '₱20' },
    { id: 'coin-10', value: 10, label: '₱10' },
    { id: 'coin-5', value: 5, label: '₱5' },
    { id: 'coin-1', value: 1, label: '₱1' },
    { id: 'coin-0.25', value: 0.25, label: '₱0.25' },
];

export const ALL_DENOMINATIONS: BillDenomination[] = [
    ...PAPER_DENOMINATIONS,
    ...COIN_DENOMINATIONS,
];
