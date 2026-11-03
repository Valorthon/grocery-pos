/** Existing sales arithmetic/access fixtures isolate approval persistence.
 * Dedicated override unit/HTTP/database specs exercise the real authority.
 */
import type { AuthUser } from '@grocery-pos/contracts';
import { ManagerOverrideService } from '../override.service';
export const MOCK_MANAGER_APPROVALS = {
    provide: ManagerOverrideService,
    useValue: {
        requiresDiscountApproval: (amount: number) => amount > 0,
        consume: jest.fn((_token: unknown, actor: AuthUser) =>
            Promise.resolve(actor.userId),
        ),
        discountContext: jest.fn(() => 'discount-context'),
        reversalContext: jest.fn(() => 'reversal-context'),
        visibleReversalSale: jest.fn(() => Promise.resolve({})),
    },
};
