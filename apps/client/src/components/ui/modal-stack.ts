/**
 * The open BaseModals, newest last, shared by every BaseModal (issues #19
 * and #22). One place owns everything that depends on which modal is on
 * top:
 *
 * - Escape: only the topmost modal answers it, and only while it is
 *   closable (not busy). A child that handles Escape itself (an open
 *   combobox list or menu) stops it from reaching the document.
 * - Focus trap: Tab and Shift+Tab wrap inside the topmost modal, and focus
 *   that lands outside it is brought back.
 * - Background: every other child of `<body>` (the app root, and any lower
 *   modal) is `inert` and `aria-hidden` while a modal is open. Elements
 *   marked `data-inert-exempt` (the toast stack) stay live.
 * - Scroll lock: the page stays locked until the last modal closes.
 * - Focus return: closing the topmost modal gives the focus back to its
 *   `returnFocus` target, else to what was focused when it opened.
 *
 * `anyModalOpen` lets a page (the register) pause its own keyboard
 * handling while a modal is up and react when the last one closes.
 */
import { computed, shallowReactive } from 'vue';

export interface ModalEntry {
    /** The backdrop: the modal's element directly under `<body>`. */
    root: () => HTMLElement | null;
    /** The dialog panel (`role="dialog"`): the focus stays inside it. */
    panel: () => HTMLElement | null;
    /** False while the modal is busy: Escape then does nothing. */
    closable: () => boolean;
    /** Asks the modal to close (Escape). */
    close: () => void;
    /** A caller-chosen element to focus on close, if any. */
    returnFocus: () => HTMLElement | null | undefined;
    /** What had the focus when it opened; restored on close. */
    opener: HTMLElement | null;
}

const stack = shallowReactive<ModalEntry[]>([]);
/** Each open modal's root as rendered: its ref is gone by the time it closes. */
const rendered = new WeakMap<ModalEntry, HTMLElement | null>();

/** True while any BaseModal is open. */
export const anyModalOpen = computed(() => stack.length > 0);

const FOCUSABLE = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
].join(',');

/** The elements Tab can reach inside `container`, in order. */
export function focusables(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) =>
            !el.matches(':disabled') &&
            !el.closest('[inert]') &&
            // Leaves out display:none / hidden elements in a browser; jsdom
            // has no layout (and no checkVisibility), so all count there.
            (typeof el.checkVisibility !== 'function' || el.checkVisibility()),
    );
}

export function isTopmost(entry: ModalEntry): boolean {
    return stack[stack.length - 1] === entry;
}

function top(): ModalEntry | undefined {
    return stack[stack.length - 1];
}

/** Elements this module made inert, so only those are given back. */
const madeInert = new Set<HTMLElement>();

function syncBackground(): void {
    const keep = top()?.root() ?? null;
    const wanted = new Set<HTMLElement>();
    if (keep) {
        for (const child of document.body.children) {
            if (
                child instanceof HTMLElement &&
                child !== keep &&
                !child.hasAttribute('data-inert-exempt') &&
                (madeInert.has(child) || !child.hasAttribute('inert'))
            ) {
                wanted.add(child);
            }
        }
    }
    for (const el of madeInert) {
        if (wanted.has(el)) continue;
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
        madeInert.delete(el);
    }
    for (const el of wanted) {
        if (madeInert.has(el)) continue;
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
        madeInert.add(el);
    }
}

function focusInto(entry: ModalEntry): void {
    const panel = entry.panel();
    if (!panel) return;
    (focusables(panel)[0] ?? panel).focus();
}

function onKeydown(event: KeyboardEvent): void {
    const entry = top();
    if (!entry || event.defaultPrevented) return;

    if (event.key === 'Escape') {
        if (entry.closable()) entry.close();
        return;
    }

    if (event.key !== 'Tab') return;
    const panel = entry.panel();
    if (!panel) return;
    const items = focusables(panel);
    const active = document.activeElement;
    const inside = active instanceof Node && panel.contains(active);
    if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (!inside || active === first || active === panel)) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
    }
}

function onFocusIn(event: FocusEvent): void {
    const entry = top();
    const panel = entry?.panel();
    if (!entry || !panel) return;
    const target = event.target;
    if (target instanceof Node && panel.contains(target)) return;
    // Exempt regions (toasts) may take a click without being yanked back.
    if (target instanceof Element && target.closest('[data-inert-exempt]')) {
        return;
    }
    focusInto(entry);
}

function listen(on: boolean): void {
    if (on) {
        document.addEventListener('keydown', onKeydown);
        document.addEventListener('focusin', onFocusIn);
    } else {
        document.removeEventListener('keydown', onKeydown);
        document.removeEventListener('focusin', onFocusIn);
    }
}

/**
 * Puts `entry` on top. Call once its DOM is rendered: the background is
 * made inert here, and the caller moves the focus in afterwards.
 */
export function pushModal(entry: ModalEntry): void {
    if (stack.includes(entry)) return;
    if (stack.length === 0) listen(true);
    stack.push(entry);
    rendered.set(entry, entry.root());
    document.body.style.overflow = 'hidden';
    syncBackground();
}

/**
 * Takes `entry` off the stack. If it was on top, the focus goes back to
 * its target; if a modal above it is still open, that modal inherits its
 * target, so the focus still ends up where the lower one was opened from.
 */
export function removeModal(entry: ModalEntry): void {
    const index = stack.indexOf(entry);
    if (index === -1) return;
    const wasTop = index === stack.length - 1;
    const target = entry.returnFocus() ?? entry.opener;
    const own = rendered.get(entry) ?? null;
    stack.splice(index, 1);

    if (!wasTop) {
        for (const above of stack.slice(index)) {
            if (
                !above.opener?.isConnected ||
                (own && above.opener && own.contains(above.opener))
            ) {
                above.opener = target;
            }
        }
    }

    if (stack.length === 0) {
        listen(false);
        document.body.style.overflow = '';
    }
    syncBackground();

    if (wasTop) {
        const next = top();
        const nextPanel = next?.panel();
        if (target?.isConnected && !target.closest('[inert]')) {
            target.focus({ preventScroll: true });
        } else if (next && nextPanel) {
            focusInto(next);
        }
    }
}
