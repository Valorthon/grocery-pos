import type { LocationQuery, RouteMeta } from 'vue-router';

/** The app's name in the browser tab (as in `index.html`). */
export const APP_TITLE = 'Grocery POS';

export interface QueryTitle {
    key: string;
    value: string;
    title: string;
    /** The view's own one-line summary (#262); else `meta.description`. */
    description?: string;
}

declare module 'vue-router' {
    interface RouteMeta {
        /** The page's name in the tab and its PageHeader; see `routeTitle`. */
        title?: string;
        /**
         * A narrower title for a filtered view of the same page, e.g.
         * Inventory's low-stock list (`?lowStock=true`, #159). A list
         * is checked in order; the first match wins (`?outOfStock`, #212).
         */
        queryTitle?: QueryTitle | QueryTitle[];
        /**
         * The one-line summary under the page title (#262), at most 110
         * characters and true for every role that can open the page.
         */
        description?: string;
    }
}

/** A tab title: `"<title> · Grocery POS"`, or the app name alone. */
export function pageTitle(title?: string): string {
    return title ? `${title} · ${APP_TITLE}` : APP_TITLE;
}

/** The title a route shows, from `meta.title` or its `queryTitle`. */
export function routeTitle(route: {
    meta?: RouteMeta;
    query?: LocationQuery;
}): string | undefined {
    const q = route.meta?.queryTitle;
    for (const t of q === undefined ? [] : Array.isArray(q) ? q : [q])
        if (route.query?.[t.key] === t.value) return t.title;
    return route.meta?.title;
}

/**
 * The summary a route shows under its title: the matching `queryTitle`'s
 * `description` when it has one, else `meta.description`.
 */
export function routeDescription(route: {
    meta?: RouteMeta;
    query?: LocationQuery;
}): string | undefined {
    const q = route.meta?.queryTitle;
    for (const t of q === undefined ? [] : Array.isArray(q) ? q : [q])
        if (route.query?.[t.key] === t.value && t.description)
            return t.description;
    return route.meta?.description;
}
