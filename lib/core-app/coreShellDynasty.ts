/**
 * Whether the /core shell (AfCoreShell) stamps the Dynasty Era identity for the league it is showing.
 *
 * The /league/[id] workspace already stamps `data-dynasty-background="true"` for a dynasty league
 * (NativeLeagueWorkspace, `usesDynastyBackground`). /core is the second surface: an imported dynasty
 * league lives there entirely, and a native one opens its My team, Matchup, Trades… screens there.
 * Without the same stamp both rendered /core's default look, so nothing on screen said "dynasty".
 *
 * ⚠ NO NEW CLASSIFICATION. The answer is `usesDynastyBackground` — `isDynastyLeague` minus the
 * specialty formats that keep their own presentation (guillotine, survivor) — exactly the rule the
 * workspace uses. This wrapper only adds what /core needs, mirroring `coreShellRedraftSport`:
 *   - no `?league=` (the cross-league dashboard, career, settings…) → false, the default look;
 *   - the fresh league record the page re-read wins over the list row, field by field: the list row
 *     (`UserLeague`) is a cached projection and its format columns can lag the league's own.
 */
import { usesDynastyBackground } from '@/lib/league-media/dynastyBackground'

type CoreShellDynastyLeague = {
  isDynasty?: boolean | null
  leagueType?: string | null
  leagueVariant?: string | null
  format?: string | null
  guillotineMode?: boolean | null
}

const FRESH_KEYS = ['isDynasty', 'leagueType', 'leagueVariant', 'guillotineMode'] as const

export function coreShellDynasty(
  league: CoreShellDynastyLeague | null | undefined,
  fresh?: Partial<Pick<CoreShellDynastyLeague, (typeof FRESH_KEYS)[number]>> | null,
): boolean {
  if (!league) return false
  const merged: CoreShellDynastyLeague = { ...league }
  if (fresh) {
    for (const key of FRESH_KEYS) {
      if (fresh[key] !== undefined) (merged as Record<string, unknown>)[key] = fresh[key]
    }
    // `format` is the list row's own derivation (`leagueVariant ?? (isDynasty ? 'dynasty' : 'redraft')`);
    // once the fresh record has spoken on the columns it is derived from, the stale copy must not outvote them.
    if (fresh.isDynasty !== undefined || fresh.leagueVariant !== undefined) merged.format = null
  }
  return usesDynastyBackground(merged)
}
