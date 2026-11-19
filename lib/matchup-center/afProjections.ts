import 'server-only'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { afEngineForLeague, lookupAfEngineProjections, lookupProjections } from '@/lib/core-app/playerProjections'
import { rosterIdSpaceOf } from '@/lib/core-app/rosterIdSpace'

/**
 * The AF engine's projection for each matchup starter, carried into THIS league's scoring — the same
 * number the draft room, /core and Chimmy show (`afEngineForLeague`), so the league page cannot
 * disagree with them.
 *
 * Returns an empty map, never throws, when the league is not in Sleeper's id space (the engine keys on
 * Sleeper ids), when the engine has no rows for the week, or when a read fails. A missing AF number
 * is shown as missing; it is never replaced with the provider's.
 */
export async function loadMatchupAfProjections(args: {
  playerIds: readonly string[]
  season: number
  week: number
  sport: string | null
  platform: string | null
  leagueSettings: unknown
}): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (rosterIdSpaceOf(args.platform, args.sport as Parameters<typeof rosterIdSpaceOf>[1]) !== 'sleeper') return out
  const ids = [...new Set(args.playerIds.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id)))]
  if (ids.length === 0) return out
  const when = { season: String(args.season), week: args.week }
  try {
    const scoring = extractScoringSettings(args.leagueSettings as Parameters<typeof extractScoringSettings>[0])
    const [providers, engine] = await Promise.all([
      lookupProjections(ids, when, null, args.sport).catch((): Awaited<ReturnType<typeof lookupProjections>> => new Map()),
      lookupAfEngineProjections(ids, when, args.sport).catch((): Awaited<ReturnType<typeof lookupAfEngineProjections>> => new Map()),
    ])
    for (const id of ids) {
      const e = engine.get(id)
      if (!e) continue
      const provider = providers.get(id)
      const league = scoring && provider?.componentStats ? computeLeagueProjectedPoints(provider.componentStats, scoring) : null
      const v = afEngineForLeague(e, provider?.projectedPoints ?? null, league?.points ?? null, scoring)
      if (v != null && Number.isFinite(v)) out.set(id, v)
    }
  } catch {
    return new Map()
  }
  return out
}

/**
 * A side's AF total: the sum over starters that HAVE an AF number, or null when none do. `from` is
 * how many starters it covers, so the UI can say when the total is partial instead of implying it is
 * the whole lineup.
 */
export function afSideTotal(starters: readonly { afProjectedPoints?: number | null }[]): { total: number | null; from: number } {
  let total = 0
  let from = 0
  for (const s of starters) {
    if (s.afProjectedPoints == null || !Number.isFinite(s.afProjectedPoints)) continue
    total += s.afProjectedPoints
    from += 1
  }
  return { total: from > 0 ? Math.round(total * 100) / 100 : null, from }
}
