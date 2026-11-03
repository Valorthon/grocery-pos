import type { UnitOfMeasure } from '@grocery-pos/contracts';
export interface SaveForm {
    description: string;
}

export interface AddForm {
    unit?: UnitOfMeasure;
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
