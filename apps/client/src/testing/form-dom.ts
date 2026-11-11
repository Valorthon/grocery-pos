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
    if (label)
        return label.querySelector('input') ? label : label.parentElement!;
    // A compact filter row names its fields by aria-label only (#254).
    const named = [
        ...document.body.querySelectorAll<HTMLElement>(
            'input[aria-label], select[aria-label]',
        ),
    ].find((el) => el.getAttribute('aria-label') === text);
    if (!named) throw new Error(`No field labelled "${text}"`);
    return named.parentElement!;
}

/** The input (or textarea) of the field whose label contains `text`. */
export function field(text: string): HTMLInputElement {
    const el =
        labelled(text).querySelector<HTMLInputElement>('input, textarea');
    if (!el) throw new Error(`No input for "${text}"`);
    return el;
}

/**
 * The error shown under the field whose label contains `text`, or ''.
 * The Base* fields use the danger token (#154); raw page fields not yet
 * restyled still use text-red-600.
 */
export function fieldError(text: string): string {
    return (
        labelled(text)
            .querySelector('p.text-danger-fg, p.text-red-600')
            ?.textContent?.trim() ?? ''
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

/** The select of the field whose label is `text`. */
export function selectField(text: string): HTMLSelectElement {
    const el = labelled(text).querySelector<HTMLSelectElement>('select');
    if (!el) throw new Error(`No select for "${text}"`);
    return el;
}

/** Opens the filter row's date-range dialog (#254). */
export async function openDates(): Promise<void> {
    const button =
        document.body.querySelector<HTMLButtonElement>('[data-date-range]');
    if (!button) throw new Error('No date-range button');
    button.click();
    await flush();
}

/** Opens the filter row's Filters dialog (#254). */
export async function openMoreFilters(): Promise<void> {
    const button = document.body.querySelector<HTMLButtonElement>(
        '[data-more-filters]',
    );
    if (!button) throw new Error('No Filters button');
    button.click();
    await flush();
}

/** Picks `value` in the select labelled `text`, as a user would. */
export async function pick(text: string, value: string): Promise<void> {
    const el = selectField(text);
    el.value = value;
    el.dispatchEvent(new Event('change'));
    await flush();
}

/** A table header's title, without its column-help tooltip text (#263). */
export function headerText(th: Element): string {
    const copy = th.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tip) => tip.remove());
    return copy.textContent?.trim() ?? '';
}

/** A stock history tile's value, found by its label text (#271). */
export function tileValue(label: string): string | undefined {
    return [
        ...document.querySelectorAll('[data-testid="stock-history-tiles"] > *'),
    ]
        .find((el) => el.querySelector('p')?.textContent?.trim() === label)
        ?.querySelector('.font-display')
        ?.textContent?.trim();
}
