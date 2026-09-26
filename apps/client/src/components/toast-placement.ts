import type { RegisterToastState, ToastPlacement } from '@/stores/ui';

/** Where Toast.vue puts its stack and how it aligns the toasts. */
export interface Placement {
    stack: string;
    items: string;
    /** Only the register's measured centre and width (CSSOM, CSP-safe). */
    style?: Record<string, string>;
}

const CENTER = 'left-1/2 -translate-x-1/2 items-center';

const FIXED: Record<Exclude<ToastPlacement, 'register'>, Placement> = {
    'top-right': {
        stack: 'top-4 right-4 items-end max-h-[calc(100vh-2rem)]',
        items: 'items-end',
    },
    'bottom-center': {
        stack: `bottom-4 ${CENTER} max-h-[calc(100vh-2rem)]`,
        items: 'items-center',
    },
};

/**
 * The register's bottom offsets (#85). Below lg the sticky Tender footer
 * is about 73px tall and the Undo bar above it reaches about 153px; from
 * lg there is no footer and the Undo bar reaches about 80px.
 */
export const REGISTER_BOTTOM = {
    plain: 'bottom-24 max-h-[calc(100vh-7rem)] lg:bottom-4 lg:max-h-[calc(100vh-2rem)]',
    aboveUndo:
        'bottom-44 max-h-[calc(100vh-12rem)] lg:bottom-24 lg:max-h-[calc(100vh-7rem)]',
} as const;

/** While the tender sheet is open: the top of the page, centred. */
export const REGISTER_TOP = `top-4 ${CENTER} max-h-[calc(100vh-2rem)]`;

/**
 * On the register (#85): at the top while the tender sheet is open (its
 * Tender & Charge is at the bottom; the page behind it is inert);
 * otherwise at the bottom, above the footer, and above the Undo bar while
 * it shows, centred on the ticket column once that is measured (it moves
 * with the sidebar), else on the viewport.
 */
function registerPlacement(state: RegisterToastState): Placement {
    if (state.sheetOpen) return { stack: REGISTER_TOP, items: 'items-center' };
    const bottom = state.undoShown
        ? REGISTER_BOTTOM.aboveUndo
        : REGISTER_BOTTOM.plain;
    const column = state.column;
    if (!column) return { stack: `${bottom} ${CENTER}`, items: 'items-center' };
    return {
        stack: `${bottom} -translate-x-1/2 items-center`,
        items: 'items-center',
        style: {
            left: `${column.center}px`,
            maxWidth: `min(28rem, ${Math.max(column.width - 32, 0)}px)`,
        },
    };
}

/** The stack's placement for the layout's choice (`uiStore`, #85). */
export function toastPlacement(
    placement: ToastPlacement,
    register: RegisterToastState,
): Placement {
    return placement === 'register'
        ? registerPlacement(register)
        : FIXED[placement];
}
