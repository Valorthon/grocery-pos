import type {
    CountedAmount,
    CurrentShiftView,
    DrawerMovementView,
    ShiftListItem,
    ZReadDrawer,
    ZReadReport,
    ZReadSales,
    ZReadTenders,
} from '../shift.js';
import type { WireShape } from '../wire-shape.js';

/** `GET /shifts/current`: the caller's open shift, or null. */
export interface CurrentShiftResponse {
    shift: CurrentShiftView | null;
}

/** `GET /shifts/last-closed`: the caller's latest Z-read, or null. */
export interface LastClosedResponse {
    report: ZReadReport | null;
}

export const DRAWER_MOVEMENT_VIEW_SHAPE: WireShape<DrawerMovementView> = {
    type: 'required',
    amount: 'required',
    reason: 'required',
    at: 'required',
    byName: 'required',
    sale: 'required',
};

export const CURRENT_SHIFT_VIEW_SHAPE: WireShape<CurrentShiftView> = {
    _id: 'required',
    status: 'required',
    cashierName: 'required',
    terminal: 'required',
    openedAt: 'required',
    openingFloat: 'required',
    movements: 'required',
};

export const COUNTED_AMOUNT_SHAPE: WireShape<CountedAmount> = {
    count: 'required',
    amount: 'required',
};

export const Z_READ_SALES_SHAPE: WireShape<ZReadSales> = {
    count: 'required',
    gross: 'required',
    discounts: 'required',
    voids: 'required',
    refunds: 'required',
    net: 'required',
};

export const Z_READ_TENDERS_SHAPE: WireShape<ZReadTenders> = {
    cash: 'required',
    gcash: 'required',
};

export const Z_READ_DRAWER_SHAPE: WireShape<ZReadDrawer> = {
    openingFloat: 'required',
    cashIn: 'required',
    cashDrops: 'required',
    reversalPayouts: 'required',
    expectedCash: 'required',
    countedCash: 'required',
    overShort: 'required',
};

export const Z_READ_REPORT_SHAPE: WireShape<ZReadReport> = {
    shiftId: 'required',
    cashierName: 'required',
    terminal: 'required',
    openedAt: 'required',
    closedAt: 'required',
    closedByName: 'required',
    closedByAdmin: 'required',
    sales: 'required',
    tenders: 'required',
    drawer: 'required',
    movements: 'required',
};

export const SHIFT_LIST_ITEM_SHAPE: WireShape<ShiftListItem> = {
    _id: 'required',
    status: 'required',
    cashierName: 'required',
    terminal: 'required',
    openedAt: 'required',
    closedAt: 'required',
    openingFloat: 'required',
    report: 'required',
};
