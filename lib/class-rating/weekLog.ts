import type { ClassLogRow } from '@/lib/class-rating/classView'

/**
 * How many rated weeks the Class log shows. Lives here, not in classView.ts, because that module
 * is `server-only` and the screen needs this number too.
 */
export const LOG_WEEKS_SHOWN = 10

/**
 * The Class log, one entry per rated WEEK.
 *
 * ⚠ THE RATING UPDATES ONCE A WEEK, NOT ONCE PER LEAGUE. Every league played that week folds
 * into one Glicko-2 update, so the log's rows (one per league-week) all carry the same
 * `weekChange`. Shown one row per league, a manager in twelve leagues saw twelve identical
 * "2026 wk 3 · +20" cards and no way to tell them apart. Grouped, the week's move is stated once
 * and each league appears as its own share of it.
 */
export type ClassWeek = {
  key: string
  season: number
  week: number
  /** The whole week's move, and the rating it left. */
  change: number
  ratingAfter: number
  /** Teams beaten (ties half) and faced, summed over the week's leagues. */
  allPlayWins: number
  allPlayGames: number
  wins: number
  losses: number
  ties: number
  /** Largest move first, either sign; the shares sum to `change`. */
  leagues: ClassLogRow[]
}

export function groupClassWeeks(rows: ClassLogRow[]): ClassWeek[] {
  const byWeek = new Map<string, ClassWeek>()
  for (const r of rows) {
    const key = `${r.season}-${r.week}`
    let w = byWeek.get(key)
    if (!w) {
      w = {
        key,
        season: r.season,
        week: r.week,
        change: r.weekChange,
        ratingAfter: r.ratingAfter,
        allPlayWins: 0,
        allPlayGames: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        leagues: [],
      }
      byWeek.set(key, w)
    }
    w.allPlayWins += r.allPlayWins
    w.allPlayGames += r.allPlayGames
    if (r.result === 'W') w.wins += 1
    else if (r.result === 'L') w.losses += 1
    else if (r.result === 'T') w.ties += 1
    w.leagues.push(r)
  }
  const weeks = [...byWeek.values()]
  // Biggest move FIRST, either direction: a phone shows only the first two lines of the list
  // (41 leagues in one week, measured), so a -6 must not sort behind forty +2s.
  for (const w of weeks) {
    w.leagues.sort(
      (a, b) =>
        Math.abs(b.leagueShare) - Math.abs(a.leagueShare) ||
        (a.leagueName ?? '').localeCompare(b.leagueName ?? '') ||
        a.leagueId.localeCompare(b.leagueId),
    )
  }
  return weeks.sort((a, b) => b.season - a.season || b.week - a.week)
}

/** "7-5" or "7-5-1"; null when no league that week had a head-to-head result. */
export function weekRecord(w: Pick<ClassWeek, 'wins' | 'losses' | 'ties'>): string | null {
  if (w.wins + w.losses + w.ties === 0) return null
  return w.ties ? `${w.wins}-${w.losses}-${w.ties}` : `${w.wins}-${w.losses}`
}
