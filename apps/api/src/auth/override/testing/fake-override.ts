/** Existing sales arithmetic/access fixtures isolate approval persistence.
 * Dedicated override unit/HTTP/database specs exercise the real authority.
 */
import type { AuthUser } from '@grocery-pos/contracts';
import { ManagerOverrideService } from '../override.service';
export const MOCK_MANAGER_APPROVALS = {
    provide: ManagerOverrideService,
    useValue: {
        assertActiveRequester: jest.fn(() => Promise.resolve()),
        requiresDiscountApproval: (amount: number) => amount > 0,
        consume: jest.fn((_token: unknown, actor: AuthUser) =>
            Promise.resolve(actor.userId),
        ),
        consumeApproval: jest.fn((_token: unknown, actor: AuthUser) =>
            Promise.resolve({
                approvedBy: actor.userId,
                approvedByName: actor.username,
            }),
        ),
        discountContext: jest.fn(() => 'discount-context'),
        reversalContext: jest.fn(() => 'reversal-context'),
        visibleReversalSale: jest.fn(() => Promise.resolve({})),
    },
};
