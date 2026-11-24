import type { PrismaClient } from '@prisma/client'

import { readWeekMarketContextByTeam } from '@/lib/odds/gameOddsReads'
import { projectionTeamKey } from '@/lib/af-projections/leagueProjectionSchedule'

/**
 * WHAT WAS KNOWN ABOUT THE GAME ITSELF BEFORE KICKOFF (owner, 2026-11-22: "weather … Vegas … coaching changes"), as
 * factor levels the learner measures like every other (`factorLearner.ts`). NFL only for now — the one sport whose
 * odds, weather and coaching are all stored per game (see the data census in the commit that added this):
 *
 *   vegas     the team's implied total from the closing line (`game_odds`, api_sports) against that week's average
 *             implied total: high (3+ points above), low (3+ below), average.
 *   weather   the last pre-kickoff forecast stored for the game (`WeatherCache`): bad (wind 15+ mph or precipitation
 *             chance 60%+, outdoors), dome (indoors or roof closed), normal.
 *   coaching  first season under a new head coach (`CoachStint`, role HC): new_coach when the team's head coach for
 *             the season differs from the season before. A team with two head coaches in one season (a mid-season
 *             firing) gets no level — the stint does not say from which week, and a guess would put games on the
 *             wrong side.
 *
 * A level is set only from stored data; a missing read is no level, never a default. Every read is contained.
 */

/** `injury` is per PLAYER, not per team — set from the pre-kickoff snapshot (`injurySnapshots.ts`). */
export type GameContextLevels = Partial<Record<'vegas' | 'weather' | 'coaching' | 'injury', string>>

export const VEGAS_GAP = 3
export const WINDY_MPH = 15
export const WET_PCT = 60

/** PURE. */
export function vegasLevel(implied: number | null | undefined, weekAverage: number | null | undefined): string | undefined {
  if (implied == null || weekAverage == null || !Number.isFinite(implied) || !Number.isFinite(weekAverage)) return undefined
  if (implied >= weekAverage + VEGAS_GAP) return 'high'
  if (implied <= weekAverage - VEGAS_GAP) return 'low'
  return 'average'
}

/** PURE. */
export function weatherLevel(w: { windSpeedMph?: number | null; precipChancePct?: number | null; isDome?: boolean | null; isIndoor?: boolean | null; roofClosed?: boolean | null } | null | undefined): string | undefined {
  if (!w) return undefined
  if (w.isDome || w.isIndoor || w.roofClosed) return 'dome'
  if ((w.windSpeedMph ?? 0) >= WINDY_MPH || (w.precipChancePct ?? 0) >= WET_PCT) return 'bad'
  if (w.windSpeedMph == null && w.precipChancePct == null) return undefined
  return 'normal'
}

/** Head coach per team per season → "new_coach" / "same_coach" for `season`. PURE. */
export function coachingLevels(stints: ReadonlyArray<{ teamId: string; season: number; coachId: string }>, season: number): Map<string, string> {
  const by = (s: number) => {
    const m = new Map<string, Set<string>>()
    for (const st of stints) if (st.season === s) m.set(st.teamId, (m.get(st.teamId) ?? new Set()).add(st.coachId))
    return m
  }
  const now = by(season)
  const before = by(season - 1)
  const out = new Map<string, string>()
  for (const [team, coaches] of now) {
    const prior = before.get(team)
    if (coaches.size !== 1 || !prior || prior.size === 0) continue
    out.set(team, prior.has([...coaches][0]!) ? 'same_coach' : 'new_coach')
  }
  return out
}

export const contextKey = (season: number, week: number, team: string) => `${season}:${week}:${team}`

type Db = Pick<PrismaClient, 'sportsGame' | 'weatherCache' | 'coachStint'>

/** Each NFL team's game context for the given weeks, keyed `season:week:TEAM` (feed codes). */
export async function loadNflGameContext(db: Db, weeks: ReadonlyArray<{ season: number; week: number }>): Promise<Map<string, GameContextLevels>> {
  const out = new Map<string, GameContextLevels>()
  const set = (season: number, week: number, team: string | null, k: keyof GameContextLevels, v: string | undefined) => {
    const code = projectionTeamKey('NFL', team)
    if (!code || !v) return
    const key = contextKey(season, week, code)
    out.set(key, { ...(out.get(key) ?? {}), [k]: v })
  }
  const unique = [...new Map(weeks.map((w) => [`${w.season}:${w.week}`, w])).values()]
  const seasons = [...new Set(unique.map((w) => w.season))]
  const stints = seasons.length
    ? await db.coachStint.findMany({ where: { role: 'HC', season: { in: [...seasons, ...seasons.map((s) => s - 1)] } }, select: { teamId: true, season: true, coachId: true } }).catch(() => [])
    : []
  const coachBySeason = new Map(seasons.map((s) => [s, coachingLevels(stints, s)]))
  for (const { season, week } of unique) {
    // Vegas: the closing line per team, against this week's average implied total.
    const market = await readWeekMarketContextByTeam('NFL', season, week).catch(() => new Map())
    const implied = [...market.values()].map((m) => m.impliedTeamTotal).filter((x): x is number => x != null && Number.isFinite(x))
    const avg = implied.length >= 4 ? implied.reduce((a, b) => a + b, 0) / implied.length : null
    for (const [team, m] of market) set(season, week, team, 'vegas', vegasLevel(m.impliedTeamTotal, avg))
    // Weather: the stored pre-kickoff forecast per game, for both teams.
    const games = await db.sportsGame.findMany({ where: { sport: 'NFL', season, week }, select: { externalId: true, homeTeam: true, awayTeam: true } }).catch(() => [])
    if (games.length) {
      const weather = await db.weatherCache
        .findMany({ where: { eventId: { in: games.map((g) => String(g.externalId)) } }, select: { eventId: true, windSpeedMph: true, precipChancePct: true, isDome: true, isIndoor: true, roofClosed: true } })
        .catch(() => [])
      const byEvent = new Map(weather.map((w) => [String(w.eventId), w]))
      for (const g of games) {
        const level = weatherLevel(byEvent.get(String(g.externalId)))
        set(season, week, g.homeTeam, 'weather', level)
        set(season, week, g.awayTeam, 'weather', level)
      }
    }
    for (const [team, level] of coachBySeason.get(season) ?? []) set(season, week, team, 'coaching', level)
  }
  return out
}
