/**
 * Test-only helpers for driving the back-office dialogs in jsdom with a
 * plain `createApp` mount (no @vue/test-utils). Dialogs teleport into
 * document.body, so every lookup starts there.
 */
import { nextTick } from 'vue';

/** Lets watchers, emits and resolved promises settle. */
export async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 5; i++) await nextTick();
}

/**
 * The element holding the field labelled `text`: an exact label match
 * wins over a partial one. A checkbox's label wraps its input.
 */
function labelled(text: string): HTMLElement {
    const labels = [...document.body.querySelectorAll('label')];
    const label =
        labels.find((l) => l.textContent?.trim() === text) ??
        labels.find((l) => l.textContent?.includes(text));
    if (!label) throw new Error(`No field labelled "${text}"`);
    return label.querySelector('input') ? label : label.parentElement!;
}

/** The input (or textarea) of the field whose label contains `text`. */
export function field(text: string): HTMLInputElement {
    const el =
        labelled(text).querySelector<HTMLInputElement>('input, textarea');
    if (!el) throw new Error(`No input for "${text}"`);
    return el;
}

/** The error shown under the field whose label contains `text`, or ''. */
export function fieldError(text: string): string {
    return (
        labelled(text).querySelector('p.text-red-600')?.textContent?.trim() ??
        ''
    );
}

/** Types `value` into the field labelled `text`, as a user would. */
export async function type(text: string, value: string): Promise<void> {
    const el = field(text);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    await nextTick();
}

/** Ticks or unticks the checkbox labelled `text`. */
export async function check(text: string, checked: boolean): Promise<void> {
    const el = field(text);
    el.checked = checked;
    el.dispatchEvent(new Event('change'));
    await nextTick();
}

/** Clicks the button whose text contains `text`. */
export async function click(text: string): Promise<void> {
    const button = [...document.body.querySelectorAll('button')].find((b) =>
        b.textContent?.includes(text),
    );
    if (!button) throw new Error(`No button "${text}"`);
    button.click();
    await flush();
}

/** Picks the first option in an open combobox list. */
export async function pickFirstMatch(): Promise<void> {
    const option = document.body.querySelector('ul li');
    if (!option) throw new Error('No combobox option to pick');
    option.dispatchEvent(new Event('mousedown'));
    await flush();
}
