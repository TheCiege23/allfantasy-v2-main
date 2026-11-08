import 'server-only'

import type { TradeValuationGap } from './tradeGrade'

import { prisma } from '@/lib/prisma'
import { latestNcaafProjectionSeason, lookupNcaafProjections } from '@/lib/core-app/ncaafProjections'
import { computeLeagueProjectedPoints, hasScoringRules, NO_LEAGUE_SCORING_REASON } from '@/lib/projections/leagueScoring'
import { normalizeSeasonType } from '@/lib/scores/gameScoreProviders'
import { resolveSportWeek } from '@/lib/season-week/seasonWeekService'
import { MAX_PLAUSIBLE_SPORT_WEEK } from '@/lib/season-week/sportWeekSignal'
import { scoringRulesFrom } from './scoringContextFromWorld'
import { playerIdSpaceFor, resolveTradePlayers, rosteredIdsOf, type PlayerIdSpace } from './tradePlayers'
import {
  ncaafSeasonWindow,
  type NcaafPerGame,
  type NcaafReplacement,
  type NcaafRosteredPlayer,
  type NcaafSeasonWindow,
} from './ncaafRedraftValue'

/**
 * What a college redraft grade is priced from, read once per league (see `./ncaafRedraftValue.ts`).
 *
 * DB-first: rosters, `AFProjectionSnapshot`, `PlayerIdentityMap` and the `SportsGame` schedule. No
 * provider call.
 *
 * ⚠ EVERY HOP IS AN ID. Rostered players are named through `resolveTradePlayers` in the league's own id
 * space (Rolling Insights for a league created here), and projections through `lookupNcaafProjections`'
 * id hop to CFBD. The only name comparison anywhere is the grade's own, and it is scoped to the players
 * rostered in this one league.
 */

export type NcaafRedraftBase = {
  rostered: NcaafRosteredPlayer[]
  perGameByRosterId: Map<string, NcaafPerGame>
  window: NcaafSeasonWindow
  /** The best free agent at each asked position, under this league's rules. Memoised per position. */
  replacementFor(positions: readonly string[]): Promise<Map<string, NcaafReplacement>>
}

export type NcaafRedraftBaseResult = { ok: true; base: NcaafRedraftBase } | { ok: false; reason: string; valuationGap?: TradeValuationGap }

/**
 * How many of a position's projected players are read to find its best free agent. Ordered by the
 * feed's own per-game figure; the rostered players come first, and a league rosters far fewer than
 * this at any one position.
 */
const REPLACEMENT_SCAN = 250

export { rosteredIdsOf } from './tradePlayers'

function perGameFrom(componentStats: Record<string, unknown> | null | undefined, rules: Record<string, unknown>): number | null {
  const scored = computeLeagueProjectedPoints(componentStats, rules)
  return scored && Number.isFinite(scored.points) ? scored.points : null
}

/** The per-game component rates the snapshot stores — the same read `lookupNcaafProjections` makes. */
function readComponentStats(adjustmentFactors: unknown): Record<string, unknown> | null {
  if (!adjustmentFactors || typeof adjustmentFactors !== 'object' || Array.isArray(adjustmentFactors)) return null
  const f = adjustmentFactors as Record<string, unknown>
  const rates = f.perGameRates ?? f.componentRates ?? null
  return rates && typeof rates === 'object' && !Array.isArray(rates) ? (rates as Record<string, unknown>) : null
}

async function lastRegularWeek(season: number): Promise<number | null> {
  const rows = await prisma.sportsGame
    .findMany({ where: { sport: 'NCAAF', season }, select: { week: true, seasonType: true }, distinct: ['week', 'seasonType'] })
    .catch(() => [] as Array<{ week: number | null; seasonType: string | null }>)
  const weeks = rows
    .filter((r) => normalizeSeasonType(r.seasonType) === 'regular')
    .map((r) => r.week)
    .filter((w): w is number => typeof w === 'number' && w >= 1 && w <= MAX_PLAUSIBLE_SPORT_WEEK)
  return weeks.length ? Math.max(...weeks) : null
}

/** A free agent must carry an id in the space this league rosters in, or nobody here can add him. */
function addableIn(space: PlayerIdSpace, row: { rollingInsightsId: string | null; espnId: string | null; fantraxId: string | null }): boolean {
  if (space === 'rolling_insights') return Boolean(row.rollingInsightsId)
  if (typeof space === 'object' && space.provider === 'espn') return Boolean(row.espnId)
  if (typeof space === 'object' && space.provider === 'fantrax') return Boolean(row.fantraxId)
  return Boolean(row.rollingInsightsId || row.espnId)
}

export async function loadNcaafRedraftBase(league: {
  id: string
  platform: string | null | undefined
  settings: unknown
}): Promise<NcaafRedraftBaseResult> {
  const rules = scoringRulesFrom(league.settings)
  if (!rules || !hasScoringRules(rules)) return { ok: false, reason: NO_LEAGUE_SCORING_REASON }

  const projected = await latestNcaafProjectionSeason()
  const season = projected ? Number.parseInt(projected.season, 10) : NaN
  if (!Number.isFinite(season)) return { ok: false, reason: 'No college projections are on file, so this league’s trades cannot be graded yet.', valuationGap: 'missing_projections' }

  const [sportWeek, lastWeek, rosterRows] = await Promise.all([
    resolveSportWeek('NCAAF', season).catch(() => null),
    lastRegularWeek(season),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true } }).catch(() => null),
  ])
  const window = ncaafSeasonWindow({
    season,
    current:
      sportWeek && sportWeek.ok
        ? { state: sportWeek.state, sportWeek: sportWeek.sportWeek, nextSportWeek: sportWeek.nextSportWeek }
        : null,
    lastRegularWeek: lastWeek,
  })
  if (!window) return { ok: false, reason: `The ${season} college schedule has no week on file, so the weeks left to play cannot be counted.`, valuationGap: 'missing_schedule' }
  if (!rosterRows) return { ok: false, reason: 'This league’s rosters could not be read just now.' }

  const rosteredIds = [...new Set(rosterRows.flatMap((r) => rosteredIdsOf(r.playerData)))]
  const rosteredSet = new Set(rosteredIds)
  const space = playerIdSpaceFor({ platform: league.platform ?? null, sport: 'NCAAF' })

  const [identities, projections] = await Promise.all([
    resolveTradePlayers(rosteredIds, { space, sport: 'NCAAF' }),
    typeof space === 'object' && space.provider === 'fantrax'
      ? lookupNcaafProjections(rosteredIds, { season: String(season) }, 'fantrax')
      : lookupNcaafProjections(rosteredIds, { season: String(season) }),
  ])

  // An id that names nobody, or two people, is left out: a deal naming him is refused, never guessed.
  const rostered: NcaafRosteredPlayer[] = []
  for (const id of rosteredIds) {
    const p = identities.get(id)
    if (p?.ok) rostered.push({ rosterPlayerId: id, name: p.name, position: p.position })
  }
  const perGameByRosterId = new Map<string, NcaafPerGame>()
  for (const [id, proj] of projections) {
    const perGame = perGameFrom(proj.componentStats, rules)
    if (perGame != null) perGameByRosterId.set(id, { perGame, position: proj.position ?? null })
  }

  const bestFreeAgent = async (position: string): Promise<NcaafReplacement | null> => {
    const rows = await prisma.aFProjectionSnapshot
      .findMany({
        where: { sport: 'NCAAF', season, week: null, position: { equals: position, mode: 'insensitive' } },
        orderBy: { afProjection: 'desc' },
        take: REPLACEMENT_SCAN,
        select: { playerId: true, playerName: true, adjustmentFactors: true },
      })
      .catch(() => [])
    if (rows.length === 0) return null
    const links = await prisma.playerIdentityMap
      .findMany({
        where: { sport: 'NCAAF', cfbdId: { in: rows.map((r) => r.playerId) } },
        select: { cfbdId: true, rollingInsightsId: true, espnId: true, fantraxId: true },
      })
      .catch(() => [])
    const linksByCfbd = new Map<string, typeof links>()
    for (const l of links) if (l.cfbdId) linksByCfbd.set(l.cfbdId, [...(linksByCfbd.get(l.cfbdId) ?? []), l])

    let best: NcaafReplacement | null = null
    for (const row of rows) {
      const ids = linksByCfbd.get(row.playerId) ?? []
      if (!ids.some((l) => addableIn(space, l))) continue
      /*
       * ⚠ ANY OF HIS IDS ON A ROSTER MEANS HE IS NOT FREE. Checked on every id the link carries, not
       * only the one this league rosters in: a rostered player whose id does not hop to CFBD would
       * otherwise read as a free agent and raise the replacement level for his whole position.
       */
      const rosteredHere = typeof space === 'object' && space.provider === 'fantrax'
        ? ids.some((link) => link.fantraxId != null && rosteredSet.has(link.fantraxId))
        : rosteredSet.has(row.playerId) ||
        ids.some((l) => [l.rollingInsightsId, l.espnId, l.fantraxId].some((id) => id != null && rosteredSet.has(id)))
      if (rosteredHere) continue
      const perGame = perGameFrom(readComponentStats(row.adjustmentFactors), rules)
      if (perGame == null) continue
      if (!best || perGame > best.perGame) best = { name: row.playerName ?? 'A free agent', perGame }
    }
    return best
  }

  const memo = new Map<string, Promise<NcaafReplacement | null>>()
  return {
    ok: true,
    base: {
      rostered,
      perGameByRosterId,
      window,
      async replacementFor(positions) {
        const out = new Map<string, NcaafReplacement>()
        await Promise.all(
          positions.map(async (raw) => {
            const position = raw.trim().toUpperCase()
            if (!position) return
            if (!memo.has(position)) memo.set(position, bestFreeAgent(position).catch(() => null))
            const r = await memo.get(position)!
            if (r) out.set(position, r)
          }),
        )
        return out
      },
    },
  }
}
