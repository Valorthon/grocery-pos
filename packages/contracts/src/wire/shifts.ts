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
    approvedByName: 'optional',
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
    storeIdentity: 'optional',
    offlineAddendum: 'optional',
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

/** At most this many terminals in `GET /shifts/terminals` (#502). */
export const TERMINALS_SEEN_LIMIT = 50;

/**
 * One terminal label the server has seen (#502): from shifts opened with it
 * and offline leases the device registered with it. Read-only, ADMIN.
 */
export interface TerminalSeen {
    label: string;
    /** ISO: the latest shift open or offline lease with this label. */
    lastSeenAt: string;
    /** Shifts opened with this label. */
    shifts: number;
    /** Offline leases registered with this label. */
    offlineLeases: number;
}

/** `GET /shifts/terminals`: newest first, at most `TERMINALS_SEEN_LIMIT`. */
export interface TerminalsSeenResponse {
    terminals: TerminalSeen[];
}

export const TERMINAL_SEEN_SHAPE: WireShape<TerminalSeen> = {
    label: 'required',
    lastSeenAt: 'required',
    shifts: 'required',
    offlineLeases: 'required',
};

export const TERMINALS_SEEN_RESPONSE_SHAPE: WireShape<TerminalsSeenResponse> = {
    terminals: 'required',
};
