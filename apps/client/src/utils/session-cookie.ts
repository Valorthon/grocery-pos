/**
 * The readable marker cookie the API sets beside the httpOnly session
 * cookies (`CookieService.createDummy`). It expires with the session, so its
 * presence tells the client a session exists without seeing the tokens. The
 * server still decides: this only steers the router.
 */
export const SESSION_MARKER_COOKIE = 'dummy';

/**
 * Whether `cookies` (a `document.cookie` string) holds the session marker.
 * Matches the name exactly, so `dummy_analytics=1` or `xdummy=1` do not
 * count, and an empty value (a cleared cookie) does not either.
 */
export function hasSessionMarker(cookies: string): boolean {
    return cookies.split(';').some((pair) => {
        const eq = pair.indexOf('=');
        if (eq < 0) return false;
        return (
            pair.slice(0, eq).trim() === SESSION_MARKER_COOKIE &&
            pair.slice(eq + 1).trim() !== ''
        );
    });
}

/** Deletes the marker, as the API does when a session ends. */
export function clearSessionMarker(domain?: string): void {
    const domainString = domain ? `; domain=${domain}` : '';
    document.cookie = `${SESSION_MARKER_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domainString}`;
}
