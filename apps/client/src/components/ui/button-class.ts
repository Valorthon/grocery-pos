export type ButtonVariant =
    'primary' | 'accent' | 'outline' | 'ghost' | 'danger' | 'danger-solid';
export type ButtonSize = 'sm' | 'md' | 'lg';

/*
 * Fresh market tokens (#155). Background colours live only in the variant
 * classes, never in `base`: Tailwind's CSS order, not class order, decides
 * which of two same-property classes wins.
 */
const base =
    'inline-flex items-center justify-center font-bold rounded-control transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none focus-ring';

const variants: Record<ButtonVariant, string> = {
    primary:
        'bg-leaf-600 text-white hover:bg-leaf-700 active:bg-leaf-800 shadow-card',
    // Citrus takes ink text: white on citrus fails WCAG AA.
    accent: 'bg-citrus-500 text-ink hover:bg-citrus-400 active:bg-citrus-600 shadow-card',
    outline:
        'bg-surface text-ink border border-line-strong hover:bg-paper shadow-card',
    ghost: 'text-ink hover:bg-paper',
    danger: 'text-danger-fg hover:bg-danger-bg',
    'danger-solid': 'bg-danger-solid text-white hover:bg-danger-fg shadow-card',
};

const sizes: Record<ButtonSize, string> = {
    sm: 'text-xs px-3 py-1.5',
    md: 'text-sm px-4 py-2.5',
    lg: 'text-base px-5 py-3.5',
};

/**
 * BaseButton's classes, for elements that must look like one but are not a
 * `<button>` (a RouterLink, say), so the two never drift apart.
 */
export function buttonClass(
    variant: ButtonVariant = 'primary',
    size: ButtonSize = 'md',
    block = false,
): string[] {
    return [base, variants[variant], sizes[size], block ? 'w-full' : ''];
}
