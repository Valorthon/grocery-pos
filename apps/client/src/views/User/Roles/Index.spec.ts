import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import {
    ASSIGNABLE_ROLES,
    PERMISSIONS,
    permissionsOf,
    Role,
} from '@grocery-pos/contracts';
import RolesPage from './Index.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(RolesPage);
    app.mount(host);
    await nextTick();
}

/** The permission badges on one role's card. */
function permissionsShown(role: Role): string[] {
    const card = document.querySelector(`[data-testid="role-${role}"]`);
    if (!card) throw new Error(`No card for ${role}`);
    return [...card.querySelectorAll('.flex-wrap > *')].map(
        (b) => b.textContent?.trim() ?? '',
    );
}

describe('Roles page (issue #24)', () => {
    it('has one card per assignable role, from contracts', async () => {
        await mount();
        const cards = [
            ...document.querySelectorAll('[data-testid^="role-"]'),
        ].map((c) => c.getAttribute('data-testid'));
        expect(cards).toEqual(ASSIGNABLE_ROLES.map((r) => `role-${r}`));
    });

    it("lists each role's permissions from the shared table", async () => {
        await mount();
        for (const role of ASSIGNABLE_ROLES) {
            expect(permissionsShown(role)).toEqual(
                permissionsOf(role).map((p) => p.label),
            );
        }
        expect(permissionsShown(Role.Admin)).toHaveLength(PERMISSIONS.length);
    });

    it('matches the route roles: sellers sell but get no stock dashboard; only admins void', async () => {
        await mount();
        // POST /sales is @Roles(Role.Seller); GET /dashboard is Adjuster,
        // Restocker and UserManager; void/refund are @Roles(Role.Admin).
        expect(permissionsShown(Role.Seller)).toContain('Sell at the register');
        expect(permissionsShown(Role.Seller)).not.toContain('Stock dashboard');
        expect(permissionsShown(Role.UserManager)).toContain('Stock dashboard');
        for (const role of ASSIGNABLE_ROLES) {
            expect(
                permissionsShown(role).includes('Void and refund sales'),
            ).toBe(role === Role.Admin);
        }
        // Price changes are ADMIN-only (assertMayChangePrices).
        expect(permissionsShown(Role.Restocker)).not.toContain('Change prices');
        expect(permissionsShown(Role.Admin)).toContain('Change prices');
    });
});
