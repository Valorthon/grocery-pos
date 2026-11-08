/** The app's name in the browser tab (as in `index.html`). */
export const APP_TITLE = 'Grocery POS';

declare module 'vue-router' {
    interface RouteMeta {
        /** The page's name in the browser tab; see `pageTitle`. */
        title?: string;
    }
}

/** A tab title: `"<title> · Grocery POS"`, or the app name alone. */
export function pageTitle(title?: string): string {
    return title ? `${title} · ${APP_TITLE}` : APP_TITLE;
}
