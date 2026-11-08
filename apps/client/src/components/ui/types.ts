/*
 * Types shared with the base components. They live in a .ts file, not in
 * the components' .vue files: typescript-eslint reads an import from a
 * .vue file through the `*.vue` shim, as an error type (issue #27).
 */

/** One option of `BaseCombobox`. */
export interface ComboboxOption {
    value: string;
    label: string;
    subtitle?: string;
    /** Text written back into the input when picked; defaults to `label`. */
    display?: string;
}

/** One column of `BaseTable`. */
export interface TableHeader {
    /** The row field shown in the column, and its `cell-<key>` slot. */
    key: string;
    title: string;
    align?: 'left' | 'right' | 'center';
    sortable?: boolean;
    /** Renders this column's cells as `<th scope="row">` (the row's label). */
    rowHeader?: boolean;
}

/** A row of `BaseTable`: any object, keyed in the DOM by `id` when set. */
export type TableRow = object & { id?: string | number };
