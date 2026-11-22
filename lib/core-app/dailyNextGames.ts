import { proTeamCode, type ProFantraxSport } from '@/lib/player-identity/proFantraxIdentityPlan'
import { normalizeLockTeam } from '@/lib/redraft/lineupLock'
import { RI_SCHEDULE_SLATE_SPORTS } from '@/lib/redraft/weekGames'
import { pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import type { PlayerCardDailySchedule } from './playerCard'

/**
 * A daily-sport player card's "next games" (2026-11-06): NBA, NHL and MLB clubs play several times a
 * week and have no byes, so the card lists his club's next games by DATE instead of the football week
 * strip. PURE — `loadDailySchedule` in playerCard.ts does the one `SportsGame` read and hands the rows here.
 *
 * ⚠ THE TEAM KEY IS NOT `normalizeTeamAbbrev`. That table is NFL-shaped — it would read an NHL "LA" as
 * the Rams — and these feeds do not agree on a spelling: TheSportsDB writes full names ("New York
 * Islanders"), espn_live writes abbreviations, and the player's own row may carry either ("NYI"). Both
 * sides go through `proTeamCode`, which knows every spelling of every club in the three sports, and
 * fall back to `normalizeLockTeam` (the lineup lock's key) for a label it does not recognise — exactly
 * `teamCode` in lib/projections/dailySportOutlook.ts, so the card and the lineup screens agree on who
 * plays whom. An unrecognised club therefore matches only its own exact name, never a neighbour's.
 *
 * ⚠ ONE FEED FOR THE WHOLE WINDOW. `SportsGame` keeps one row PER FEED per game, so an un-deduped read
 * lists every game two or three times. The rows are selected the way the week finalizer and the lineup
 * lock select a daily sport's week (weekGames.ts `readWeekGames`): `week` dropped (daily feeds carry
 * junk week numbers), one slice, and `coverageBarIncludesStale` so a fresh partial feed cannot win
 * over a complete one that missed a refresh.
 */

const DAILY_NEXT_GAMES = 5
/** How far ahead the card reads. Five games is about ten days; three weeks clears an All-Star break. */
export const DAILY_LOOKAHEAD_DAYS = 21
/** How far back, so the current fantasy week's earlier games can be counted. A week is seven days. */
export const DAILY_LOOKBACK_DAYS = 8

const DAY_MS = 86_400_000

/** The sports whose card lists next games by date. Football keeps its week strip. */
export function isDailyGamesCardSport(sport: string | null | undefined): boolean {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NBA' || s === 'NHL' || s === 'MLB'
}

/** The key a club is compared on for these sports. Null for no club at all. */
export function dailyTeamCode(sport: string, team: string | null | undefined): string | null {
  const raw = String(team ?? '').trim()
  if (!raw) return null
  const s = sport.trim().toUpperCase()
  const code = isDailyGamesCardSport(s) ? proTeamCode(s as ProFantraxSport, raw) : undefined
  return code ?? (normalizeLockTeam(s, raw) || null)
}

/** A game that will not be played as scheduled is not one of his next games. */
const NOT_PLAYED = /postpon|cancel|suspend|replaced|abandon/i

export type DailyGameRow = {
  homeTeam: string | null
  awayTeam: string | null
  startTime: Date | null
  status: string | null
  source: string | null
  fetchedAt: Date | null
  season: number | null
  week?: number | null
}

/**
 * His club's next games and this week's count from a sport's rows around `now`. `games` empty = none on
 * file for HIS club (including a club no row names) — the caller says so rather than show anyone else's.
 */
export function selectDailyNextGames(
  rows: readonly DailyGameRow[],
  args: { sport: string; team: string | null | undefined; now: Date; count?: number },
): Pick<PlayerCardDailySchedule, 'games' | 'gamesThisWeek'> {
  const sport = args.sport.trim().toUpperCase()
  const club = dailyTeamCode(sport, args.team)
  const now = args.now.getTime()
  if (!club) return { games: [], gamesThisWeek: null }

  const dated = rows
    .filter((r) => r.startTime != null && Number.isFinite(r.startTime.getTime()))
    .map((r) => ({ ...r, week: null }))
  const slate = pickFreshestSourceRows(dated, now, 'week', { coverageBarIncludesStale: true })

  const mine = slate
    .filter((r) => !NOT_PLAYED.test(String(r.status ?? '')))
    .map((r) => {
      const home = dailyTeamCode(sport, r.homeTeam)
      const away = dailyTeamCode(sport, r.awayTeam)
      if (home === club && away !== club) return { row: r, home: true, opponent: r.awayTeam }
      if (away === club && home !== club) return { row: r, home: false, opponent: r.homeTeam }
      return null
    })
    .filter((g): g is NonNullable<typeof g> => g != null)
    .sort((a, b) => a.row.startTime!.getTime() - b.row.startTime!.getTime())

  const upcoming = mine.filter((g) => g.row.startTime!.getTime() >= now)
  const games = upcoming.slice(0, args.count ?? DAILY_NEXT_GAMES).map((g) => {
    const opponent = String(g.opponent ?? '').trim()
    return {
      startTime: g.row.startTime!.toISOString(),
      opponent: (isDailyGamesCardSport(sport) ? proTeamCode(sport as ProFantraxSport, opponent) : undefined) ?? (opponent || '—'),
      home: g.home,
    }
  })

  return { games, gamesThisWeek: games.length > 0 ? weekCount(sport, slate, mine, upcoming, args.now) : null }
}

/**
 * His club's games in the fantasy week holding `now`, by Eastern calendar day — the rule the stat sync,
 * the finalizer and the lineup lock bucket on. Null rather than a guess whenever the week is unknown.
 */
function weekCount(
  sport: string,
  slate: readonly DailyGameRow[],
  mine: ReadonlyArray<{ row: DailyGameRow }>,
  upcoming: ReadonlyArray<{ row: DailyGameRow }>,
  now: Date,
): number | null {
  // MLB's complete slate is the Rolling Insights schedule, not SportsGame: a count here could be short.
  if (RI_SCHEDULE_SLATE_SPORTS.includes(sport)) return null
  const season = upcoming[0]?.row.season ?? null
  if (season == null) return null
  const week = dailySportWeekForInstant(sport, season, now)
  const window = week != null ? resolveDailySportWeekWindow(sport, season, week) : null
  if (!window) return null
  // The window must lie inside what was read, or its first days were never asked about.
  if (window.start.getTime() < now.getTime() - DAILY_LOOKBACK_DAYS * DAY_MS) return null
  const inWeek = (r: DailyGameRow) => {
    const day = easternCalendarDay(r.startTime)
    return day != null && day >= window.start && day < window.end
  }
  // A week nobody has a game in is a slate we do not hold, not a week he sits out.
  if (!slate.some(inWeek)) return null
  return mine.filter((g) => inWeek(g.row)).length
}
