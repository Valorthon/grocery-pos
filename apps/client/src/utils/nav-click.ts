/**
 * Whether a click on a navigation link is a plain left click, which the
 * app handles in this tab through the router (so its guards apply) (#143).
 * Anything else (Ctrl/Cmd/Shift/Alt, another button, or a click already
 * handled) is left to the browser: a new tab or window, with this page and
 * any open drawer left as they are. The same test as RouterLink's own.
 */
export function isPlainClick(e: MouseEvent): boolean {
    return (
        !e.defaultPrevented &&
        e.button === 0 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey
    );
}
