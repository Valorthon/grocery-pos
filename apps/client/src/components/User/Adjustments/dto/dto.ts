export interface SaveForm {
    description: string;
}

export interface AddForm {
    EAN: string;
    name: string;
    change: number;
    reason: string;
    product: string;
}

/**
 * The add dialog's form state: change is a number, or '' while blank
 * (`v-model.number`). Validated by `adjustmentLineErrors`.
 */
export interface AddFormInput extends Omit<AddForm, 'change'> {
    change: number | string;
}
