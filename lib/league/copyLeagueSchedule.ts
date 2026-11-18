/**
 * Copy leagues, part 2 — the real NFL schedule (docs/league-page/COPY_LEAGUES_DESIGN.md §3–4). Pure: no Prisma.
 * The database half is ./copyLeagueScheduleService.ts.
 *
 * GAMES → WEEKS. Real games are read from `SportsGame` (two writers, both by cron; never a provider call here):
 *   - `api_sports` rows carry `week` and `seasonType` — used as they are, regular season only;
 *   - `rolling_insights` rows carry neither, and may include preseason and playoff games — their week is
 *     derived from the games themselves: the season's first game on or after Sep 1 sets week 1, anchored to
 *     the THURSDAY on or before it (US Eastern dates), and every game falls in its Thursday-to-Wednesday
 *     window. A Monday-night game stays in its week. Anything past week 18 is a playoff game and is dropped.
 *   `nflWeekForDate` (lib/import-os/season.ts) is NOT used: it anchors to a fixed Sep 4 with Friday windows,
 *   which puts a Thursday-night game in the previous week.
 * The two sources can hold the same game; it counts once. A derived week in which a team plays twice is
 * reported as unusable rather than guessed at.
 *
 * COVERAGE. An NFL week has 13–16 games (byes). A week with fewer than 13 games is treated as not loaded:
 * pairing from part of a week would turn missing games into fake "paired" matchups.
 *
 * PAIRING, one week at a time:
 *   1. A real game between two picked teams is that week's matchup, home and away as played.
 *   2. Every other team — its real opponent nobody picked, its team on bye, or no real team at all — is paired
 *      with another such team: fewest meetings so far this season first, then same real division, then same
 *      conference. The start of the line rotates by week. Deterministic: applying twice gives the same weeks.
 *   3. An odd one out gets the bye (`away: null`), which the existing odd-team rule turns into the median.
 */
import { getTeamInfo, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import type { CustomPair } from '@/lib/schedule-runtime/customWeeks'

export const MAX_NFL_REGULAR_WEEK = 18
export const MIN_GAMES_FOR_A_WEEK = 13

/** NFL divisions, for pairing teams whose real opponent nobody picked. */
const NFL_DIVISIONS: Record<string, { conference: 'AFC' | 'NFC'; division: string }> = Object.fromEntries(
  ([
    ['AFC', 'East', ['BUF', 'MIA', 'NE', 'NYJ']],
    ['AFC', 'North', ['BAL', 'CIN', 'CLE', 'PIT']],
    ['AFC', 'South', ['HOU', 'IND', 'JAX', 'TEN']],
    ['AFC', 'West', ['DEN', 'KC', 'LV', 'LAC']],
    ['NFC', 'East', ['DAL', 'NYG', 'PHI', 'WAS']],
    ['NFC', 'North', ['CHI', 'DET', 'GB', 'MIN']],
    ['NFC', 'South', ['ATL', 'CAR', 'NO', 'TB']],
    ['NFC', 'West', ['ARI', 'LAR', 'SF', 'SEA']],
  ] as const).flatMap(([conference, division, codes]) => codes.map((c) => [c, { conference, division: `${conference} ${division}` }])),
)

export function nflDivisionOf(code: string | null | undefined) {
  return code ? NFL_DIVISIONS[code] ?? null : null
}

export type GameRow = {
  homeTeam: string | null
  awayTeam: string | null
  week: number | null
  seasonType: string | null
  startTime: Date | string | null
}

export type RealGame = { home: string; away: string }

function code(raw: string | null): string | null {
  const c = normalizeTeamAbbrev(raw)
  return c && getTeamInfo(c) ? c : null
}

/** The calendar date of an instant in US Eastern, as days since the epoch. */
function easternDay(d: Date): number {
  const ymd = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // YYYY-MM-DD
  return Math.floor(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000)
}

export type RealWeeks = {
  /** week → its games, codes canonical. */
  weeks: Map<number, RealGame[]>
  /** Derived weeks dropped because a team played twice in them. */
  unusable: number[]
}

export function realWeeksFromGames(rows: readonly GameRow[], seasonYear: number): RealWeeks {
  const seen = new Set<string>()
  const weeks = new Map<number, RealGame[]>()
  const add = (week: number, home: string, away: string) => {
    const key = `${week}:${[home, away].sort().join('-')}`
    if (seen.has(key)) return
    seen.add(key)
    const list = weeks.get(week) ?? []
    list.push({ home, away })
    weeks.set(week, list)
  }

  // Rows that come with a regular-season week.
  const undated: Array<{ home: string; away: string; day: number }> = []
  const septFirst = Math.floor(Date.UTC(seasonYear, 8, 1) / 86_400_000)
  for (const r of rows) {
    const home = code(r.homeTeam)
    const away = code(r.awayTeam)
    if (!home || !away || home === away) continue
    const type = String(r.seasonType ?? '').toLowerCase()
    if (type === 'pre' || type === 'post') continue
    if (type === 'regular' && Number.isInteger(r.week) && r.week! >= 1 && r.week! <= MAX_NFL_REGULAR_WEEK) {
      add(r.week!, home, away)
      continue
    }
    if (!r.startTime) continue
    const t = new Date(r.startTime)
    if (Number.isNaN(t.getTime())) continue
    const day = easternDay(t)
    if (day >= septFirst) undated.push({ home, away, day })
  }

  // Rows without one: Thursday-anchored windows from the season's first game.
  const unusable = new Set<number>()
  if (undated.length) {
    const first = Math.min(...undated.map((g) => g.day))
    const dow = new Date(first * 86_400_000).getUTCDay() // 0 Sun … 4 Thu
    const anchor = first - ((dow - 4 + 7) % 7)
    const derived = new Map<number, Array<{ home: string; away: string }>>()
    for (const g of undated) {
      const week = Math.floor((g.day - anchor) / 7) + 1
      if (week < 1 || week > MAX_NFL_REGULAR_WEEK) continue
      const list = derived.get(week) ?? []
      list.push(g)
      derived.set(week, list)
    }
    for (const [week, games] of derived) {
      // Twice in one window can be the same game from both sources — dedupe decides; a real double is unusable.
      const distinct = new Set(games.map((g) => [g.home, g.away].sort().join('-')))
      const perTeam = new Map<string, number>()
      for (const k of distinct) for (const c of k.split('-')) perTeam.set(c, (perTeam.get(c) ?? 0) + 1)
      if ([...perTeam.values()].some((n) => n > 1)) {
        unusable.add(week)
        continue
      }
      for (const g of games) add(week, g.home, g.away)
    }
  }
  for (const w of unusable) weeks.delete(w)
  return { weeks, unusable: [...unusable].sort((a, b) => a - b) }
}

export function weekIsLoaded(games: readonly RealGame[] | undefined): boolean {
  return (games?.length ?? 0) >= MIN_GAMES_FOR_A_WEEK
}

export type CopyTeam = { rosterId: string; code: string | null }

const metKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** a < b, comparing element by element. */
function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!
  return false
}

/** One week's pairs: real games first, the rest paired as described above. `met` is updated in place. */
export function pairWeek(input: {
  week: number
  games: readonly RealGame[]
  teams: readonly CopyTeam[]
  met: Map<string, number>
}): { pairs: CustomPair[]; real: CustomPair[] } {
  const byCode = new Map<string, string>()
  for (const t of input.teams) if (t.code) byCode.set(t.code, t.rosterId)
  const used = new Set<string>()
  const pairs: CustomPair[] = []
  const real: CustomPair[] = []
  const meet = (a: string, b: string) => input.met.set(metKey(a, b), (input.met.get(metKey(a, b)) ?? 0) + 1)

  for (const g of input.games) {
    const home = byCode.get(g.home)
    const away = byCode.get(g.away)
    if (!home || !away || used.has(home) || used.has(away)) continue
    used.add(home)
    used.add(away)
    const p = { home, away }
    pairs.push(p)
    real.push(p)
    meet(home, away)
  }

  const codeOf = new Map(input.teams.map((t) => [t.rosterId, t.code]))
  const left = input.teams.map((t) => t.rosterId).filter((id) => !used.has(id))
  const shift = left.length ? input.week % left.length : 0
  const line = [...left.slice(shift), ...left.slice(0, shift)]
  while (line.length > 1) {
    const a = line.shift()!
    const da = nflDivisionOf(codeOf.get(a))
    let best = 0
    let bestScore: number[] | null = null
    line.forEach((b, i) => {
      const db = nflDivisionOf(codeOf.get(b))
      const score = [
        input.met.get(metKey(a, b)) ?? 0,
        da && db && da.division === db.division ? 0 : 1,
        da && db && da.conference === db.conference ? 0 : 1,
        i,
      ]
      if (!bestScore || lexLess(score, bestScore)) {
        bestScore = score
        best = i
      }
    })
    const b = line.splice(best, 1)[0]!
    pairs.push({ home: a, away: b })
    meet(a, b)
  }
  if (line.length === 1) pairs.push({ home: line[0]!, away: null })
  return { pairs, real }
}

export type RealSchedulePlan = Array<{ week: number; loaded: boolean; pairs: CustomPair[]; real: CustomPair[]; games: number }>

/** Every week to set, in order, with meetings carried across weeks so pairings rotate. */
export function planRealSchedule(input: { weeks: readonly number[]; real: RealWeeks; teams: readonly CopyTeam[] }): RealSchedulePlan {
  const met = new Map<string, number>()
  return [...input.weeks].sort((a, b) => a - b).map((week) => {
    const games = input.real.weeks.get(week) ?? []
    if (!weekIsLoaded(games)) return { week, loaded: false, pairs: [], real: [], games: games.length }
    const { pairs, real } = pairWeek({ week, games, teams: input.teams, met })
    return { week, loaded: true, pairs, real, games: games.length }
  })
}
