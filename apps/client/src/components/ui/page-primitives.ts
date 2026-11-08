import type { RouteLocationRaw } from 'vue-router';

/** One applied filter shown as a removable chip in FilterBar (#157). */
export interface FilterChip {
    /** Stable id the page maps back to its input, e.g. `category`. */
    key: string;
    /** What the chip reads, e.g. `Category: Dairy`. */
    label: string;
}

/** One PageHeader breadcrumb; the last one usually has no `to`. */
export interface Breadcrumb {
    label: string;
    to?: RouteLocationRaw;
}
