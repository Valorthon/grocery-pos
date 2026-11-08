/** One item of a `RowActions` menu (#172). */
export interface RowAction {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    /** Destructive (archive, delete): shown in the danger colour. */
    danger?: boolean;
}
