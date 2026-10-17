import 'server-only'

import { prisma } from '@/lib/prisma'
import { latestProjectionWeek } from './playerProjections'
import { loadRailProjections } from './railMatchups'
import type { LeagueContextRow } from './leagueContext'

/**
 * Every team's lineup, projected for this week — AllFantasy's own engine (AF) and the provider's
 * (API), each summed over the lineup as set and scored under the league's rules. The standings
 * screen's "This week's lineups" section.
 *
 * ⚠ THE RAIL'S PRICING, NOT A THIRD COPY. `loadRailProjections` already prices a whole league's field
 * for the rail's elimination rows — league scoring, injuries and byes, the foreign-id refusal, AF
 * carried into the league by the provider line. Standings hands it every roster in the league, so a
 * team's number here is the same number the rail and Your Week draw for it.
 *
 * ⚠ A DIFFERENT MEASURE FROM THE TABLE. The standings rank on points already scored; this is a
 * projection of the coming week. The screen labels it as one and never ranks the table by it.
 */

export type StandingsLineupRow = {
  /** `LeagueTeam.externalId` — the same key the standings rows carry as `rosterId`. */
  rosterId: string
  name: string | null
  isYou: boolean
  /** AF total, or null when the engine priced nobody on the lineup. */
  af: number | null
  afFrom: number
  /** Provider total under the league's rules, or null. */
  api: number | null
  apiFrom: number
  starterCount: number
}

export type StandingsLineups = {
  season: number
  /** The week the projections describe — the feed's, stated on screen. */
  week: number
  rows: StandingsLineupRow[]
}

export async function getStandingsLineups(args: {
  league: Pick<LeagueContextRow, 'id' | 'platformLeagueId'>
  userId: string
}): Promise<StandingsLineups | null> {
  const when = await latestProjectionWeek().catch(() => null)
  if (!when) return null
  const season = Number(when.season)
  if (!Number.isFinite(season)) return null

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: args.league.id },
      select: {
        externalId: true,
        platformUserId: true,
        claimedByUserId: true,
        teamName: true,
        ownerName: true,
      },
    })
    .catch(() => [])
  const withIds = teams.filter((t): t is typeof t & { externalId: string } => Boolean(t.externalId))
  if (withIds.length === 0) return null

  /* Only a key: the rail loader pairs it with each roster id to find that team's lineup. */
  const leagueKey = args.league.platformLeagueId ?? args.league.id
  const teamByKey = new Map(
    withIds.map((t) => [
      `${leagueKey}:${t.externalId}`,
      {
        externalId: String(t.externalId),
        // The same three candidates the rail tries, in the same order (see railMatchups.ts).
        rosterKeys: [t.platformUserId, t.claimedByUserId, String(t.externalId)].filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        ),
      },
    ]),
  )

  const priced = await loadRailProjections({
    fixtures: [{ dbLeagueId: args.league.id, platformLeagueId: leagueKey, rosterIds: withIds.map((t) => String(t.externalId)) }],
    teamByKey,
    season,
    week: when.week,
  }).catch(() => null)
  const sides = priced?.byLeague.get(args.league.id)?.sides
  if (!sides || sides.size === 0) return null
  // The feed can fall back to another week; state the week actually served.
  const week = priced?.projectionWeek?.week ?? when.week

  const rows: StandingsLineupRow[] = withIds.flatMap((t) => {
    const s = sides.get(String(t.externalId))
    if (!s) return []
    return [{
      rosterId: String(t.externalId),
      name: t.teamName?.trim() || t.ownerName?.trim() || null,
      isYou: t.claimedByUserId === args.userId,
      af: s.afEngine ?? null,
      afFrom: s.afEngineFrom ?? 0,
      api: s.afProjected,
      apiFrom: s.pricedFrom,
      starterCount: s.starterCount,
    }]
  })
  if (!rows.some((r) => r.af != null || r.api != null)) return null

  /* Highest AF first; a team AF could not price sorts after every priced one, by API. */
  rows.sort((a, b) => (b.af ?? -Infinity) - (a.af ?? -Infinity) || (b.api ?? -Infinity) - (a.api ?? -Infinity))
  return { season: Number(priced?.projectionWeek?.season ?? season), week, rows }
}
