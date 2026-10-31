/**
 * Which sport theme the /core shell (AfCoreShell) stamps for the league it is showing, or null.
 *
 * The /league/[id] workspace already stamps `data-format="redraft"` + `data-sport` on its root
 * (NativeLeagueWorkspace). The /core sidebar the owner uses — My team, Matchup, Waivers, Trades,
 * Standings… — is a second surface, and without the same two attributes a native redraft league
 * opened there renders the default look. This is the ONE decision for that surface.
 *
 * ⚠ NO NEW CLASSIFICATION. The answer is `resolveRedraftIdentity`, the foundation's rule
 * (lib/league-media/redraftIdentity.ts): native platform, plain redraft format, no specialty
 * variant, a sport the redraft engine runs. This wrapper only adds what /core needs on top:
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

export function coreShellRedraftSport(
  league: RedraftIdentityLeague | null | undefined,
  freshPlatform?: string | null,
): RedraftSportTheme | null {
  if (!league) return null
  const platform = freshPlatform?.trim() ? freshPlatform : league.platform
  return resolveRedraftIdentity({ ...league, platform })?.sport ?? null
}
