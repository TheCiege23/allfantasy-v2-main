/**
 * 🛑 ALLFANTASY NEVER CHOPS AN IMPORTED LEAGUE. A Guilly league imported from Sleeper (or any provider)
 * is chopped by the provider; we only mirror what its sync brings back. Our engine choosing a team
 * itself would write a second, different chop and — through `releaseChoppedRosters` — empty that
 * team's roster here, on top of whatever the provider decided.
 *
 * It was reachable: the specialty-automation Guilly handler called `runElimination` with no platform
 * check, and the engine's only gate was a `GuillotineLeagueConfig` row — which the Guilly settings
 * page writes for any league that reads as Guilly. So the guard sits in the places that write a chop
 * or a config, not in their callers: the engine's entry, the roster release, the config writer, and
 * the settings route (lib/guillotine/GuillotineEliminationEngine.ts, GuillotineRosterReleaseEngine.ts,
 * GuillotineLeagueConfig.ts, app/api/leagues/[leagueId]/guillotine/summary/route.ts).
 *
 * "Imported" is `isNativePlatform`'s complement: a missing platform counts as native (legacy rows predate
 * the column and were created here), so no native league is ever refused by this.
 */
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

export const IMPORTED_CHOP_REASON = 'imported league: its chops are decided by the provider'

/** The league exists and was imported from a provider. Unknown league = false (the caller's own 404 applies). */
export async function isImportedLeague(leagueId: string): Promise<boolean> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  return league != null && !isNativePlatform(league.platform)
}

/** The provider's name for a refusal a commissioner can read. */
export function providerLabel(platform: string | null | undefined): string {
  const p = String(platform ?? '').trim().toLowerCase()
  const names: Record<string, string> = { sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MyFantasyLeague', myfantasyleague: 'MyFantasyLeague', fleaflicker: 'Fleaflicker', fantrax: 'Fantrax', nfl: 'NFL Fantasy' }
  return names[p] ?? 'the platform it was imported from'
}
