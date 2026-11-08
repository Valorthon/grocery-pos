import type { Role } from '@grocery-pos/contracts';
import { homeRouteFor, type HomeRoute } from '@/router/access';

/** Where the not-found page sends the reader, and what the link says. */
export function notFoundLink(
    isAuthenticated: boolean,
    roles: readonly Role[],
): { to: HomeRoute; label: string } {
    if (!isAuthenticated) return { to: { name: 'Login' }, label: 'Log in' };
    const to = homeRouteFor(roles);
    if (to.name === 'SellerDashboard') return { to, label: 'Go to register' };
    if (to.name === 'Dashboard') return { to, label: 'Go to dashboard' };
    // A session that opens no page; the guard ends it on the way to Login.
    return { to, label: 'Log in' };
}
