/*
 * One field style for BaseInput, BaseSelect, BaseCombobox and BaseCheckbox
 * (#154), on the Fresh market tokens in `assets/main.css`.
 */

/**
 * FIELD_LABEL without its bottom margin, for a label in a row that carries
 * the margin itself (a label + ⓘ row). Never add `mb-0` to FIELD_LABEL:
 * `mb-1.5` comes later in the stylesheet and wins (#301).
 */
export const FIELD_LABEL_TEXT = 'block text-sm font-semibold text-ink';

/** Sentence-case label above a field, tied to it by `for`/`id`. */
export const FIELD_LABEL = `${FIELD_LABEL_TEXT} mb-1.5`;

/** Border, radius, text and the leaf keyboard focus ring. */
export const FIELD_BASE =
    'w-full py-2.5 rounded-control border text-sm text-ink placeholder-muted focus-ring focus-visible:border-leaf-600 transition-colors';

/** FIELD_BASE at the compact size: same tokens, less padding, smaller text. */
export const FIELD_BASE_SM = FIELD_BASE.replace('py-2.5', 'py-1').replace(
    'text-sm',
    'text-xs',
);

/**
 * A read-only value box beside fields (#294): FIELD_BASE's padding, text,
 * border width and radius, so one line is exactly as tall as an input, on
 * a filled background so it doesn't look editable. Long values wrap.
 */
export const FIELD_READONLY =
    'w-full min-w-0 px-3.5 py-2.5 rounded-control border border-line bg-paper text-sm text-ink num break-words';

export const FIELD_OK = 'border-line-strong bg-surface';
export const FIELD_ERROR = 'border-danger-fg bg-danger-bg';
/** A combobox with a picked option. */
export const FIELD_SELECTED = 'border-leaf-500 bg-surface';
export const FIELD_DISABLED = 'opacity-50 cursor-not-allowed';

/** Inline validation message under a field (never below `text-xs`). */
export const FIELD_ERROR_TEXT = 'text-xs text-danger-fg mt-1';
/** Hint or confirmation text under a field. */
export const FIELD_HINT_TEXT = 'mt-1 text-xs text-success-fg';

/** Icons inside the field. */
export const FIELD_ICON = 'text-muted';

export const CHECKBOX_INPUT = 'h-4 w-4 accent-leaf-600 focus-ring';
export const CHECKBOX_LABEL = 'text-sm text-ink';
