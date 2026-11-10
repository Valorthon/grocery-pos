/** A status's badge label and colour (#242). */
export type StatusMap<S extends string> = Record<
    S,
    {
        label: string;
        color: 'success' | 'error' | 'warning' | 'info' | 'primary' | 'neutral';
    }
>;
