/**
 * One draft-table look (#173) for the Restock, Adjustment and purchase
 * order editors: BaseTable's tokens (paper header, line dividers, ink
 * text), right-aligned tabular numbers and 44px row actions.
 */
export const draftTable = {
    /** Scrolls sideways on a phone (375px) instead of squeezing columns. */
    wrap: 'overflow-x-auto',
    table: 'w-full text-left border-collapse text-sm',
    headRow: 'text-xs font-semibold uppercase tracking-wider text-muted',
    th: 'py-3 px-5 bg-paper border-b border-line',
    thNum: 'py-3 px-5 bg-paper border-b border-line text-right',
    body: 'divide-y divide-line text-ink',
    row: 'hover:bg-paper transition-colors',
    td: 'py-2 px-5 align-middle',
    tdName: 'py-2 px-5 align-middle font-semibold',
    tdMuted: 'py-2 px-5 align-middle text-muted',
    /** Quantities and money: right-aligned tabular figures. */
    tdNum: 'py-2 px-5 align-middle text-right num',
    tdActions: 'py-2 px-5 align-middle text-right',
} as const;
