import { onBeforeUnmount, ref, shallowRef } from 'vue';
import type { ManagerOverrideRequest } from '@grocery-pos/contracts';

export type ApprovalRequest = Pick<
    ManagerOverrideRequest,
    'action' | 'context'
>;

/** Approval credentials and tokens stay in memory, never in saved baskets. */
export function useManagerApproval() {
    const isApprovalOpen = ref(false);
    const approvalRequest = shallowRef<ApprovalRequest | null>(null);
    const approvalSummary = ref('');
    let settle: ((token: string | null) => void) | null = null;
    function finish(token: string | null) {
        const resolve = settle;
        settle = null;
        isApprovalOpen.value = false;
        approvalRequest.value = null;
        approvalSummary.value = '';
        resolve?.(token);
    }
    function requestApproval(
        request: ApprovalRequest,
        summary: string,
    ): Promise<string | null> {
        finish(null);
        approvalRequest.value = request;
        approvalSummary.value = summary;
        isApprovalOpen.value = true;
        return new Promise((resolve) => {
            settle = resolve;
        });
    }
    onBeforeUnmount(() => finish(null));
    return {
        isApprovalOpen,
        approvalRequest,
        approvalSummary,
        requestApproval,
        completeApproval: (token: string) => finish(token),
        cancelApproval: () => finish(null),
    };
}
