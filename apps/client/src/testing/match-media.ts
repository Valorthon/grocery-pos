/**
 * A controllable `window.matchMedia` for jsdom, which has none (#26). Every
 * query answers `matches`; `set` changes it and notifies the listeners, as
 * a browser does when the window crosses a breakpoint. `restore` removes
 * the stub again.
 */
export function stubMatchMedia(initial: boolean) {
    let matches = initial;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const hadOwn = Object.prototype.hasOwnProperty.call(window, 'matchMedia');
    const previous = window.matchMedia;

    window.matchMedia = ((query: string) => ({
        get matches() {
            return matches;
        },
        media: query,
        onchange: null,
        addEventListener: (
            _type: string,
            listener: (event: MediaQueryListEvent) => void,
        ) => listeners.add(listener),
        removeEventListener: (
            _type: string,
            listener: (event: MediaQueryListEvent) => void,
        ) => listeners.delete(listener),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    return {
        set(next: boolean) {
            matches = next;
            for (const listener of listeners) {
                listener({ matches: next } as MediaQueryListEvent);
            }
        },
        restore() {
            if (hadOwn) window.matchMedia = previous;
            else delete (window as { matchMedia?: unknown }).matchMedia;
        },
    };
}
