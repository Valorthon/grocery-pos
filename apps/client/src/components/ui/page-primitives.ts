import type { RouteLocationRaw } from 'vue-router';

/** One PageHeader breadcrumb; the last one usually has no `to`. */
export interface Breadcrumb {
    label: string;
    to?: RouteLocationRaw;
}
