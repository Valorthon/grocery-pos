/**
 * Clicks a link as a user would (`init` adds modifiers or another button)
 * and tells whether the app took the click (prevented the browser's
 * default, as the router does on a plain click) or left it to the browser
 * (a new tab or window, #143). The browser's part is then cancelled, since
 * jsdom does not navigate.
 */
export function clickLink(
    link: HTMLElement,
    init: MouseEventInit = {},
): { appTookIt: boolean } {
    let appTookIt = false;
    const after = (e: Event) => {
        appTookIt = e.defaultPrevented;
        e.preventDefault();
    };
    window.addEventListener('click', after);
    try {
        link.dispatchEvent(
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0,
                ...init,
            }),
        );
    } finally {
        window.removeEventListener('click', after);
    }
    return { appTookIt };
}

/** The modified clicks a browser opens in a new tab or window. */
export const NEW_TAB_CLICKS: readonly [string, MouseEventInit][] = [
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    // A real middle click fires `auxclick`, not `click`, so the app never
    // sees it; a `click` from any non-primary button is left alone too.
    ['non-primary button', { button: 1 }],
];
