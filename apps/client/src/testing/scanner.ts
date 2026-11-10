/**
 * Types `code` + Enter as a keyboard-wedge scanner would (issue #214):
 * keydowns on the focused element (else the document), back to back.
 */
export function wedgeScan(code: string, target?: EventTarget): KeyboardEvent {
    const on = target ?? document.activeElement ?? document.body;
    for (const key of code)
        on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    const enter = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
    });
    on.dispatchEvent(enter);
    return enter;
}
