import { projectionTeamKey } from '@/lib/af-projections/leagueProjectionSchedule'

import { COACH_STINTS, type CoachStintEntry } from './coachStints'

/**
 * WHO WAS COACHING EACH NBA, NHL AND MLB TEAM ON A GIVEN DAY (owner, 2026-11-23: "search online to find out … what
 * coaches are on specific teams, who gets fired, who gets hired"), for the `coaching` projection factor.
 *
 * NFL reads `CoachStint` (nflverse, one row per team per season). No feed we hold carries NBA, NHL or MLB coaches, so
 * their head coaches (managers, in MLB) are a committed, sourced list (`coachStints.ts`), each stint with the date it
 * began and ended — a mid-season firing splits a season on the day it happened, which a per-season row cannot do.
 *
 *   new_coach   the game falls in the coach's first season in charge of that team, interim coaches included, and a
 *               mid-season replacement from the day he took over to the end of that season. A hire after the
 *               regular season ends is for the next season, and one in its last month makes the next season new
 *               too.
 *   same_coach  any later season.
 *
 * A day no stint covers, or one two stints both claim, has no level — never a guess. The list goes stale the day a
 * coach is fired; a scheduled research session re-checks it weekly and proposes the change as a pull request.
 */

export const COACH_REGISTRY_SPORTS = ['NBA', 'NHL', 'MLB'] as const
export type CoachRegistrySport = (typeof COACH_REGISTRY_SPORTS)[number]

/**
 * The day each sport's season turns over (month is 1-based), placed in the offseason so an offseason hire belongs to
 * the season he is hired for: NBA and NHL finals end in June; MLB's World Series by early November.
 */
const SEASON_TURNOVER: Record<CoachRegistrySport, { month: number; day: number }> = {
  NBA: { month: 7, day: 1 },
  NHL: { month: 7, day: 1 },
  MLB: { month: 11, day: 15 },
}

/**
 * The day each regular season ends, roughly. A coach who takes over after it — fired in April, hired in May or June,
 * or an MLB manager hired in October — first coaches the NEXT season, even though the playoff games before the
 * turnover above still belong to the old one.
 */
const REGULAR_SEASON_END: Record<CoachRegistrySport, { month: number; day: number }> = {
  NBA: { month: 4, day: 14 },
  NHL: { month: 4, day: 17 },
  MLB: { month: 9, day: 29 },
}

/** A takeover this close to the end of a regular season is a few games, not a season: the next one is new too. */
const LATE_TAKEOVER_DAYS = 30

/**
 * The seasons a coach who took over on `fromMs` counts as new: the first one he coaches, and — after a takeover in a
 * regular season's last month (Denver's, 2025-04-08, three games from the end) — the next one as well. PURE.
 */
export function coachNewSeasons(sport: CoachRegistrySport, fromMs: number): { first: number; last: number } {
  const season = coachSeasonOf(sport, fromMs)
  const y = new Date(fromMs).getUTCFullYear()
  const end = REGULAR_SEASON_END[sport]
  const t = SEASON_TURNOVER[sport]
  const endMs = Date.UTC(y, end.month - 1, end.day)
  const offseason = endMs <= fromMs && fromMs < Date.UTC(y, t.month - 1, t.day)
  if (offseason) return { first: season + 1, last: season + 1 }
  const late = fromMs < endMs && endMs - fromMs <= LATE_TAKEOVER_DAYS * 86_400_000
  return { first: season, last: late ? season + 1 : season }
}

/** Spellings one sport's feeds disagree on (`projectionTeamKey` leaves both). */
const SAME_TEAM: Partial<Record<CoachRegistrySport, Record<string, string>>> = { MLB: { WSN: 'WSH' } }

export const isCoachRegistrySport = (sport: string): sport is CoachRegistrySport =>
  (COACH_REGISTRY_SPORTS as readonly string[]).includes(sport.toUpperCase())

/** One code per team, whichever feed spelled it. PURE. */
export function coachTeamKey(sport: CoachRegistrySport, team: string | null | undefined): string | null {
  const code = projectionTeamKey(sport, team ?? null)
  if (!code) return null
  return SAME_TEAM[sport]?.[code] ?? code
}

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/** The season a moment belongs to, as the year it turns over in. PURE. */
export function coachSeasonOf(sport: CoachRegistrySport, atMs: number): number {
  const d = new Date(atMs)
  const y = d.getUTCFullYear()
  const t = SEASON_TURNOVER[sport]
  return Date.UTC(y, t.month - 1, t.day) <= atMs ? y + 1 : y
}

type Indexed = Map<string, Array<{ fromMs: number; toMs: number; newSeasons: { first: number; last: number } }>>
const cache = new Map<string, Indexed>()

function indexFor(sport: CoachRegistrySport, stints: ReadonlyArray<CoachStintEntry>): Indexed {
  const out: Indexed = new Map()
  const last = new Map<string, { coach: string; toMs: number; newSeasons: { first: number; last: number } }>()
  for (const s of [...stints].sort((a, b) => a.from.localeCompare(b.from))) {
    const team = coachTeamKey(sport, s.team)
    const fromMs = dayMs(s.from)
    // `to` is the day he was let go: the day itself belongs to whoever coached that night, so his stint ends before it.
    const toMs = s.to ? dayMs(s.to) : Infinity
    if (!team || !Number.isFinite(fromMs) || !(toMs > fromMs)) continue
    // An interim coach given the job for good keeps the season he started in: one tenure, not two.
    const prev = last.get(team)
    const continues = prev && prev.coach === s.coach.trim().toLowerCase() && Math.abs(prev.toMs - fromMs) <= 2 * 86_400_000
    const newSeasons = continues ? prev!.newSeasons : coachNewSeasons(sport, fromMs)
    last.set(team, { coach: s.coach.trim().toLowerCase(), toMs, newSeasons })
    out.set(team, [...(out.get(team) ?? []), { fromMs, toMs, newSeasons }])
  }
  return out
}

/** The coaching level for one team's game at `atMs`, or undefined when the list cannot say. PURE. */
export function coachingLevelOn(
  sport: string,
  team: string | null | undefined,
  atMs: number,
  stints: ReadonlyArray<CoachStintEntry> | null = null,
): 'new_coach' | 'same_coach' | undefined {
  const s = sport.toUpperCase()
  if (!isCoachRegistrySport(s) || !Number.isFinite(atMs)) return undefined
  const list = stints ?? COACH_STINTS[s]
  let index = stints ? null : cache.get(s) ?? null
  if (!index) {
    index = indexFor(s, list)
    if (!stints) cache.set(s, index)
  }
  const key = coachTeamKey(s, team)
  if (!key) return undefined
  // Game logs carry a date, often at midnight: compare by day, so a firing "on" a date covers that whole date.
  const day = Math.floor(atMs / 86_400_000) * 86_400_000
  const covering = (index.get(key) ?? []).filter((st) => st.fromMs <= day && day < st.toMs)
  if (covering.length !== 1) return undefined
  const season = coachSeasonOf(s, day)
  const { first, last } = covering[0]!.newSeasons
  return season >= first && season <= last ? 'new_coach' : 'same_coach'
}
