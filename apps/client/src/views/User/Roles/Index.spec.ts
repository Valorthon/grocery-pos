import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import {
    appPermissionsOf,
    ASSIGNABLE_ROLES,
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

    it("lists each role's app permissions from the shared table", async () => {
        await mount();
        for (const role of ASSIGNABLE_ROLES) {
            expect(permissionsShown(role)).toEqual(
                appPermissionsOf(role).map((p) => p.label),
            );
        }
    });

    it('hides what has no screen yet (decision 2026-09-25)', async () => {
        await mount();
        for (const role of ASSIGNABLE_ROLES) {
            const shown = permissionsShown(role);
            // No screen until #38.
            expect(shown).not.toContain('Change prices');
            expect(shown).not.toContain('Edit product details (not price)');
            // Every role has the profile menu's Change password (#88).
            expect(shown).toContain('Change own password');
        }
        // Adding products is Restocker and Admin only, on the page and the
        // API (#83).
        expect(permissionsShown(Role.Adjuster)).not.toContain('Add products');
        expect(permissionsShown(Role.Restocker)).toContain('Add products');
        expect(permissionsShown(Role.Admin)).toContain('Add products');
        // The register needs the SELLER role itself, on the page and the
        // API (#84).
        expect(permissionsShown(Role.Admin)).not.toContain(
            'Sell at the register',
        );
        expect(permissionsShown(Role.Admin)).not.toContain(
            'Run own cash shift',
        );
        expect(permissionsShown(Role.Admin)).toContain('Void and refund sales');
    });

    it('tells on the Admin card only that an admin needs SELLER to sell (#84)', async () => {
        await mount();
        const notes = [...document.querySelectorAll('[data-testid^="note-"]')];
        expect(notes.map((n) => n.getAttribute('data-testid'))).toEqual([
            `note-${Role.Admin}`,
        ]);
        expect(notes[0].textContent?.trim()).toBe(
            'To sell, an admin also needs the Seller role.',
        );
    });

    it('matches the route roles: sellers sell but get no stock dashboard; only admins void', async () => {
        await mount();
        // POST /sales is @RequireOwnRole(Role.Seller); GET /dashboard is Adjuster,
        // Restocker and UserManager; void/refund are @Roles(Role.Admin).
        expect(permissionsShown(Role.Seller)).toContain('Sell at the register');
        expect(permissionsShown(Role.Seller)).not.toContain('Stock dashboard');
        expect(permissionsShown(Role.UserManager)).toContain('Stock dashboard');
        for (const role of ASSIGNABLE_ROLES) {
            expect(
                permissionsShown(role).includes('Void and refund sales'),
            ).toBe(role === Role.Admin);
        }
        expect(permissionsShown(Role.Adjuster)).toContain(
            'Create and view adjustments',
        );
        expect(permissionsShown(Role.Restocker)).not.toContain(
            'Create and view adjustments',
        );
    });
});
