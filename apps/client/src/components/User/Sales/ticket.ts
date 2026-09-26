import { countOf } from '@/utils/plural';

/**
 * The Void Ticket question (#85): lines and units, e.g. "Void this ticket
 * (2 lines, 5 items)?".
 */
export function voidTicketMessage(lines: number, units: number): string {
    return `Void this ticket (${countOf(lines, 'line')}, ${countOf(units, 'item')})?`;
}
