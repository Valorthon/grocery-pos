import { SaleStatus } from '@grocery-pos/contracts';
import type { StatusMap } from '@/components/ui/status-badge';

/** A sale's status badge: voided red, refunded amber (#243). */
export const SALE_STATUS: StatusMap<SaleStatus> = {
    [SaleStatus.COMPLETED]: { label: 'Completed', color: 'success' },
    [SaleStatus.VOIDED]: { label: 'Voided', color: 'error' },
    [SaleStatus.REFUNDED]: { label: 'Refunded', color: 'warning' },
};
