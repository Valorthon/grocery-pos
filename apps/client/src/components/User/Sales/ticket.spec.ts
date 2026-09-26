import { describe, expect, it } from 'vitest';
import { voidTicketMessage } from './ticket';

describe('voidTicketMessage (#85)', () => {
    it('counts lines and items in the plural', () => {
        expect(voidTicketMessage(2, 5)).toBe(
            'Void this ticket (2 lines, 5 items)?',
        );
    });

    it('uses the singular for one line and one item', () => {
        expect(voidTicketMessage(1, 1)).toBe(
            'Void this ticket (1 line, 1 item)?',
        );
    });

    it('mixes one line of several items', () => {
        expect(voidTicketMessage(1, 3)).toBe(
            'Void this ticket (1 line, 3 items)?',
        );
    });
});
