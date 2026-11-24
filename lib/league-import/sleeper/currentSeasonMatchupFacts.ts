/**
 * Keeps the season being played current in `dw_matchup_facts` for an imported league, from the
 * schedule the league sync has already fetched. No provider call is made here.
 *
 * Covers Sleeper, ESPN and Fantrax. Each provider's history service writes these rows at import
 * with its own conventions, and this writer matches them exactly (see `MATCHUP_FACT_CONVENTIONS`),
 * so the two never fight over a row. ESPN and Fantrax have no scheduled history refresh at all:
 * measured 2026-11-24, every in-season ESPN league's rows were frozen at its import date (six of
 * twelve were all 0-0) while `team_performances` was current to week 11.
 *
 * WHY THIS EXISTS (measured on production 2026-11-20, NFL week 11). The only writer of these rows
 * was `SleeperHistoricalMatchupSyncService`, reached at import and from
 * `/api/cron/sleeper-historical-refresh`. That cron's rotation had jammed: 93 backfill-status rows
 * whose league had been deleted sat at the front of its oldest-first queue, took all 15 reserved
 * slots on every fire, and were dropped again by the league lookup, so only the 10 most recently
 * viewed leagues were refreshed. 519 of 547 in-season leagues had no score past week 6 to 10.
 * Meanwhile the league sync fetched every played week for every league several times a day and
 * wrote it to `team_performances` only (592 of 594 leagues current to week 11).
 *
 * So the rows are written from that same payload. The historical service still owns past seasons,
 * brackets and season metadata; for the current season the two write the same rows:
 *   - team ids are Sleeper roster ids (`LeagueTeam.externalId`), as `canonicalIdsForSeason` gives
 *     for the current season;
 *   - teamA is the lower roster id;
 *   - an unplayed week is 0-0 with no winner.
 *
 * Only weeks the payload carries are touched, one week at a time, and only when that week's stored
 * rows differ. A week the provider did not answer for keeps what is stored.
 *
 * A concurrent run of the historical service (delete season, insert season) can interleave with
 * this and leave a week doubled. The comparison below counts rows, so the next sync sees the
 * difference and rewrites that week.
 *
 * Off switch: `AF_LIVE_MATCHUP_FACTS_OFF=1` on the service that runs the sync.
 */
import { normalizeSportForWarehouse } from '@/lib/data-warehouse/types'
import { prisma } from '@/lib/prisma'
import type { NormalizedMatchup } from '../types'

export type MatchupFactProvider = 'sleeper' | 'espn' | 'fantrax'

type MatchupFactConvention = {
  /**
   * `lowerFirst`: teamA is the lower numeric roster id (Sleeper's history sync sorts the pair).
   * `asProvided`: teamA is the provider's first team (ESPN and Fantrax keep their own order).
   */
  order: 'lowerFirst' | 'asProvided'
  /** Whether a matchup with no score yet is stored (as 0-0, no winner) or left out. */
  writeUnplayed: boolean
}

/**
 * What each provider's history service writes, which this writer must reproduce:
 *   sleeper  `SleeperHistoricalMatchupSyncService`   lower roster id first, unplayed weeks as 0-0
 *   espn     `EspnHistoricalBackfillService`         ESPN's order, undecided matchups as 0-0
 *   fantrax  `FantraxHistoricalBackfillService`      Fantrax's order, unplayed matchups not written
 */
export const MATCHUP_FACT_CONVENTIONS: Record<MatchupFactProvider, MatchupFactConvention> = {
  sleeper: { order: 'lowerFirst', writeUnplayed: true },
  espn: { order: 'asProvided', writeUnplayed: true },
  fantrax: { order: 'asProvided', writeUnplayed: false },
}

export function isMatchupFactProvider(value: unknown): value is MatchupFactProvider {
  return value === 'sleeper' || value === 'espn' || value === 'fantrax'
}

export type CurrentSeasonMatchupFact = {
  weekOrPeriod: number
  teamA: string
  teamB: string
  scoreA: number
  scoreB: number
  winnerTeamId: string | null
}

type CurrentSeasonMatchupFactsResult = {
  /** Weeks the schedule carried with at least one head-to-head pairing. */
  weeksSeen: number
  /** Weeks whose stored rows differed and were replaced. */
  weeksWritten: number
  rowsWritten: number
  skipped?: string
}

function rosterNumber(id: string): number | null {
  const n = Number(id)
  return id.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function score(value: unknown): number {
  return isScore(value) ? value : 0
}

/**
 * The schedule as matchup-fact rows, in the given provider's conventions. Pure. A pairing without
 * two distinct teams is not a game.
 */
export function matchupFactsFromSchedule(
  schedule: ReadonlyArray<NormalizedMatchup>,
  provider: MatchupFactProvider = 'sleeper',
): CurrentSeasonMatchupFact[] {
  const convention = MATCHUP_FACT_CONVENTIONS[provider]
  const out: CurrentSeasonMatchupFact[] = []
  const seen = new Set<string>()
  for (const week of schedule) {
    if (!Number.isInteger(week.week) || week.week <= 0) continue
    for (const mu of week.matchups ?? []) {
      const id1 = String(mu.roster_id_1 ?? '').trim()
      const id2 = String(mu.roster_id_2 ?? '').trim()
      if (!id1 || !id2 || id1 === id2) continue
      if (!convention.writeUnplayed && !(isScore(mu.points_1) && isScore(mu.points_2))) continue
      let firstIsA = true
      if (convention.order === 'lowerFirst') {
        const one = rosterNumber(id1)
        const two = rosterNumber(id2)
        if (one == null || two == null) continue
        firstIsA = one < two
      }
      const teamA = firstIsA ? id1 : id2
      const teamB = firstIsA ? id2 : id1
      const key = `${week.week}:${teamA}:${teamB}`
      if (seen.has(key)) continue
      seen.add(key)
      const scoreA = score(firstIsA ? mu.points_1 : mu.points_2)
      const scoreB = score(firstIsA ? mu.points_2 : mu.points_1)
      out.push({
        weekOrPeriod: week.week,
        teamA,
        teamB,
        scoreA,
        scoreB,
        winnerTeamId: scoreA > scoreB ? teamA : scoreB > scoreA ? teamB : null,
      })
    }
  }
  return out
}

const signature = (r: CurrentSeasonMatchupFact) =>
  `${r.teamA}|${r.teamB}|${r.scoreA}|${r.scoreB}|${r.winnerTeamId ?? ''}`

/** The weeks whose stored rows are not exactly the incoming ones (duplicates count as different). Pure. */
export function weeksNeedingRewrite(
  incoming: ReadonlyArray<CurrentSeasonMatchupFact>,
  stored: ReadonlyArray<CurrentSeasonMatchupFact>,
): number[] {
  const byWeek = (rows: ReadonlyArray<CurrentSeasonMatchupFact>) => {
    const map = new Map<number, string[]>()
    for (const r of rows) {
      if (!map.has(r.weekOrPeriod)) map.set(r.weekOrPeriod, [])
      map.get(r.weekOrPeriod)!.push(signature(r))
    }
    return map
  }
  const next = byWeek(incoming)
  const prior = byWeek(stored)
  const weeks: number[] = []
  for (const [week, signatures] of next) {
    const have = prior.get(week) ?? []
    if (have.length !== signatures.length || [...have].sort().join('\n') !== [...signatures].sort().join('\n')) {
      weeks.push(week)
    }
  }
  return weeks.sort((a, b) => a - b)
}

export function liveMatchupFactsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = String(env.AF_LIVE_MATCHUP_FACTS_OFF ?? '').trim().toLowerCase()
  return !(raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes')
}

export async function writeCurrentSeasonMatchupFacts(input: {
  leagueId: string
  /** Defaults to Sleeper, the first provider this covered. */
  provider?: MatchupFactProvider
  sport: string
  /** The season the schedule belongs to. Null means the provider did not say, and nothing is written. */
  season: number | null
  schedule: ReadonlyArray<NormalizedMatchup>
}): Promise<CurrentSeasonMatchupFactsResult> {
  const none = (skipped: string): CurrentSeasonMatchupFactsResult => ({ weeksSeen: 0, weeksWritten: 0, rowsWritten: 0, skipped })
  if (!liveMatchupFactsEnabled()) return none('switched off')
  if (input.season == null || !Number.isInteger(input.season)) return none('no season')

  const incoming = matchupFactsFromSchedule(input.schedule, input.provider ?? 'sleeper')
  if (incoming.length === 0) return none('no pairings in schedule')
  const incomingWeeks = [...new Set(incoming.map((r) => r.weekOrPeriod))]

  const stored = await prisma.matchupFact.findMany({
    where: { leagueId: input.leagueId, season: input.season, weekOrPeriod: { in: incomingWeeks } },
    select: { weekOrPeriod: true, teamA: true, teamB: true, scoreA: true, scoreB: true, winnerTeamId: true },
  })

  const weeks = weeksNeedingRewrite(incoming, stored)
  if (weeks.length === 0) return { weeksSeen: incomingWeeks.length, weeksWritten: 0, rowsWritten: 0 }

  const sport = normalizeSportForWarehouse(input.sport)
  const season = input.season
  const rows = incoming
    .filter((r) => weeks.includes(r.weekOrPeriod))
    .map((r) => ({ leagueId: input.leagueId, sport, season, ...r }))

  await prisma.$transaction([
    prisma.matchupFact.deleteMany({
      where: { leagueId: input.leagueId, season, weekOrPeriod: { in: weeks } },
    }),
    prisma.matchupFact.createMany({ data: rows }),
  ])

  return { weeksSeen: incomingWeeks.length, weeksWritten: weeks.length, rowsWritten: rows.length }
}
