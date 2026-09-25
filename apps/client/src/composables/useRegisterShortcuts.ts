import { onBeforeUnmount, onMounted } from 'vue';
import { anyModalOpen } from '@/components/ui/modal-stack';

/**
 * The register's keys (issue #22, product decision 2026-09-25). F5 is
 * never bound: it stays the browser's refresh. F4 and Delete belong to
 * #23 (line quantity and line void) and are added to Sell.vue's map there.
 */
export const REGISTER_KEYS = {
    /** Focus the scan / search box. */
    SCAN: 'F2',
    /** Open the order discount. */
    DISCOUNT: 'F8',
    /** Open Tender & Charge. */
    CHARGE: 'F9',
} as const;

export interface Shortcut {
    run: (event: KeyboardEvent) => void;
    /**
     * Whether the key works while the focus is in a text field. Defaults
     * to true for function keys (they type nothing) and false for every
     * other key, so e.g. Delete still deletes text in a field.
     */
    whileTyping?: boolean;
}

/** `KeyboardEvent.key` → what it does. */
export type ShortcutMap = Record<string, Shortcut | Shortcut['run']>;

/** True for elements that take typed text (not buttons, checkboxes…). */
export function isTextEntry(el: Element | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
    if (!(el instanceof HTMLInputElement)) return false;
    return ![
        'button',
        'checkbox',
        'radio',
        'submit',
        'reset',
        'range',
        'color',
        'file',
        'image',
    ].includes(el.type);
}

const isFunctionKey = (key: string) => /^F\d{1,2}$/.test(key);

/**
 * Page-level shortcuts, active while the calling component is mounted
 * (the register only). They are off while any modal is open: a modal
 * answers its own keys (the checkout's Enter and Escape). A key with
 * Ctrl, Alt, Meta or Shift held, or one already handled, is left alone.
 * A handled key's default is prevented.
 */
export function useRegisterShortcuts(shortcuts: ShortcutMap): void {
    function onKeydown(event: KeyboardEvent) {
        if (event.defaultPrevented || anyModalOpen.value) return;
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
            return;
        }
        const binding = shortcuts[event.key];
        if (!binding) return;
        const { run, whileTyping = isFunctionKey(event.key) } =
            typeof binding === 'function' ? { run: binding } : binding;
        if (!whileTyping && isTextEntry(document.activeElement)) return;
        event.preventDefault();
        run(event);
    }

    onMounted(() => window.addEventListener('keydown', onKeydown));
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}
