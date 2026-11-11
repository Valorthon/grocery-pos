import type { StatusMap } from './status-badge';
import type { HelpItem } from './types';

/**
 * Column help for a status column (#263), built from its badge map, so a
 * status without a meaning fails to compile (`Record<S, string>`) and the
 * terms always read like the badges.
 */
export function statusHelp<S extends string>(
    map: StatusMap<S>,
    meanings: Record<S, string>,
): HelpItem[] {
    return (Object.keys(map) as S[]).map((status) => ({
        term: map[status].label,
        meaning: meanings[status],
    }));
}

/** Column help for a column showing raw enum values (types, roles, tenders). */
export function enumHelp<S extends string>(
    meanings: Record<S, string>,
): HelpItem[] {
    return (Object.keys(meanings) as S[]).map((value) => ({
        term: value,
        meaning: meanings[value],
    }));
}
