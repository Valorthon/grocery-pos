import type { WireShape } from '../wire-shape.js';
import type { AdjustmentRow, RestockRow } from './catalog.js';
import type { SaleRow } from './sales.js';

/**
 * A restock in the dashboard's activity feed. For a non-admin the API
 * sends only these fields (`RESTOCK_ACTIVITY_FIELDS`): never `totalCost`.
 * An ADMIN gets the whole row.
 */
export type RestockActivity = Pick<
    RestockRow,
    '_id' | 'description' | 'restockedBy' | 'createdAt'
> &
    Partial<Pick<RestockRow, 'totalCost' | 'updatedAt'>>;

export const RESTOCK_ACTIVITY_SHAPE: WireShape<RestockActivity> = {
    _id: 'required',
    description: 'required',
    restockedBy: 'required',
    createdAt: 'required',
    totalCost: 'optional',
    updatedAt: 'optional',
};

/**
 * `GET /dashboard`. Money is ADMIN-only and left out on the server for
 * every other role (issue #13): `todayRevenue` and `recentSales` are
 * absent, and `recentRestocks` carry no `totalCost`.
 */
export interface DashboardView {
    totalProducts: number;
    /** Products with 1 to LOW_STOCK_THRESHOLD units on hand. */
    lowStockCount: number;
    /** Products with 0 (or fewer) units on hand. */
    outOfStockCount: number;
    /** Store-wide count of today's sales that were not reversed. */
    todaySalesCount: number;
    /** Newest first, at most 5. */
    recentRestocks: RestockActivity[];
    /** Newest first, at most 5. */
    recentAdjustments: AdjustmentRow[];
    /** Centavos. ADMIN only. */
    todayRevenue?: number;
    /** Newest first, at most 5. ADMIN only. */
    recentSales?: SaleRow[];
}

export const DASHBOARD_VIEW_SHAPE: WireShape<DashboardView> = {
    totalProducts: 'required',
    lowStockCount: 'required',
    outOfStockCount: 'required',
    todaySalesCount: 'required',
    recentRestocks: 'required',
    recentAdjustments: 'required',
    todayRevenue: 'optional',
    recentSales: 'optional',
};

/** The dashboard keys only an ADMIN receives. */
export const DASHBOARD_MONEY_KEYS = ['todayRevenue', 'recentSales'] as const;
