/** One item of a `RowActions` menu (#172). */
export interface RowAction {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    /** Why a disabled item can't be used, shown under its label (#311). */
    reason?: string;
    /** Destructive (archive, delete): shown in the danger colour. */
    danger?: boolean;
}
