import { createApp, h, type App } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { OverrideAction } from '@grocery-pos/contracts';
import { useManagerApproval } from './useManagerApproval';
let app: App | undefined;
function mount() {
    let approval!: ReturnType<typeof useManagerApproval>;
    app = createApp({
        setup() {
            approval = useManagerApproval();
            return () => h('div');
        },
    });
    const host = document.createElement('div');
    document.body.append(host);
    app.mount(host);
    return approval;
}
const request = {
    action: OverrideAction.VOID,
    context: { reversal: { saleId: 'sale', reason: 'Return' } },
};
afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
});
describe('approval lifecycle', () => {
    it('returns the token and clears pending context on approval', async () => {
        const a = mount();
        const promise = a.requestApproval(request, 'Return sale');
        expect(a.isApprovalOpen.value).toBe(true);
        expect(a.approvalSummary.value).toBe('Return sale');
        a.completeApproval('token');
        expect(await promise).toBe('token');
        expect(a.approvalRequest.value).toBeNull();
        expect(a.isApprovalOpen.value).toBe(false);
    });
    it('settles cancellation and replacing an older request without storing any credential', async () => {
        const a = mount();
        const first = a.requestApproval(request, 'First');
        const second = a.requestApproval(request, 'Second');
        expect(await first).toBeNull();
        a.cancelApproval();
        expect(await second).toBeNull();
    });
    it('settles any pending request on unmount', async () => {
        const a = mount();
        const promise = a.requestApproval(request, 'x');
        app!.unmount();
        app = undefined;
        expect(await promise).toBeNull();
    });
});
