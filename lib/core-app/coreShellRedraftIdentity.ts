/**
 * Which sport theme the /core shell (AfCoreShell) stamps for the league it is showing, or null.
 *
 * The /league/[id] workspace already stamps `data-format="redraft"` + `data-sport` on its root
 * (NativeLeagueWorkspace). The /core sidebar the owner uses — My team, Matchup, Waivers, Trades,
 * Standings… — is a second surface, and without the same two attributes a native redraft league
 * opened there renders the default look. This is the ONE decision for that surface.
 *
 * ⚠ NO NEW CLASSIFICATION. The answer is `resolveRedraftIdentity`, the foundation's rule
 * (lib/league-media/redraftIdentity.ts): a native redraft league, or an IMPORTED one whose stored data
 * positively says redraft (batch B-ID); plain redraft format, no specialty variant, a sport the
 * redraft engine runs. Since native leagues redirect from /core's Home to /league/[id], the imported
 * case is the one most /core league screens actually render. This wrapper only adds what /core needs on top:
 *   - no `?league=` (the cross-league dashboard, career, settings…) → null, the default look;
 *   - the platform the page re-read for the league (`selectedLeagueRecord.platform`) wins over the
 *     list row's, the same precedence the page already uses for `nativeLeague` — a stale list row
 *     must not theme an imported league as an AllFantasy one.
 */
import {
  resolveRedraftIdentity,
  type RedraftIdentityLeague,
  type RedraftSportTheme,
} from '@/lib/league-media/redraftIdentity'

/**
 * The league row /core re-read for this request (`leagueContext.league()`), as far as the identity
 * reads it. The list row (`UserLeague`) carries no `settings`, and an IMPORTED league's redraft
 * evidence lives only there (lib/league-media/redraftIdentity.ts `isImportedRedraftLeague`), so
 * without this an imported league can never theme. Its format columns win over the list row's for
 * the same reason its platform does: it is the fresh read.
 */
export type CoreShellFreshLeague = Pick<
  RedraftIdentityLeague,
  'sport' | 'leagueType' | 'leagueVariant' | 'isDynasty' | 'bestBallMode' | 'guillotineMode' | 'settings'
>

export function coreShellRedraftSport(
  league: RedraftIdentityLeague | null | undefined,
  freshPlatform?: string | null,
  fresh?: CoreShellFreshLeague | null,
): RedraftSportTheme | null {
  if (!league) return null
  const platform = freshPlatform?.trim() ? freshPlatform : league.platform
  const merged: RedraftIdentityLeague = { ...league, platform }
  if (fresh) {
    for (const key of ['sport', 'leagueType', 'leagueVariant', 'isDynasty', 'bestBallMode', 'guillotineMode', 'settings'] as const) {
      if (fresh[key] !== undefined) (merged as Record<string, unknown>)[key] = fresh[key]
    }
  }
  return resolveRedraftIdentity(merged)?.sport ?? null
}
