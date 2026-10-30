/**
 * The Guilly tab for an IMPORTED league (2026-10-30), built from the provider's own weekly scores.
 *
 * A native Guilly league's tab (GuillotineHome) reads AllFantasy's chop engine: chop rows, danger tiers,
 * period scores. An imported league has none of those — its provider chops it (./importedLeagueGuard.ts)
 * — so that tab either never showed (most imports carry `leagueType: 'guillotine'` and nothing the tab
 * gate reads) or showed and failed ("Not a Guilly league") for the older rows still flagged
 * `guillotineMode`. This is what an imported league can honestly show instead: this week's scores among
 * the teams still alive with the chop line marked, who has been chopped and when, and how many are left —
 * all read from the scores the sync brings back, by the same rule as the reliability check
 * (./importedGuillyHealth.ts `chopTimeline`).
 *
 * Pure. The loader is ./importedGuillyHealthLoad.ts; the tab is app/league/[leagueId]/tabs/ImportedGuillyTab.tsx.
 */
import { chopTimeline, importedGuillyFormat, type ImportedGuillyRow } from './importedGuillyHealth'

export type ImportedGuillyStanding = {
  rosterId: string
  name: string
  points: number
  /** This week's lowest score among the teams still alive (ties all shown). */
  onChopLine: boolean
}

export type ImportedGuillyViewData = {
  /** The week being (or last) played; null before any score. */
  week: number | null
  /** This week's teams still alive, highest score first. */
  standings: ImportedGuillyStanding[]
  /** Teams chopped so far, most recent first. */
  chopped: Array<{ rosterId: string; name: string; week: number }>
  teamsAlive: number
  /** How many of the alive teams have scored this week (0 = the week has not started). */
  scoredThisWeek: number
}

export function buildImportedGuillyView(args: {
  rows: ReadonlyArray<ImportedGuillyRow>
  /** Every team in the league: provider roster id → name. */
  teams: ReadonlyArray<{ rosterId: string; name: string }>
}): ImportedGuillyViewData {
  const scoredWeeks = args.rows.filter((r) => r.pointsFor > 0).map((r) => r.week)
  const week = scoredWeeks.length ? Math.max(...scoredWeeks) : null
  const nameOf = new Map(args.teams.map((t) => [t.rosterId, t.name]))
  const name = (id: string) => nameOf.get(id) ?? `Team ${id}`
  const { out } = week == null ? { out: new Map<string, number>() } : chopTimeline(args.rows, week)

  const alive = args.teams.filter((t) => !out.has(t.rosterId))
  const pointsThisWeek = new Map(args.rows.filter((r) => r.week === week).map((r) => [r.rosterId, r.pointsFor]))
  const scored = alive.filter((t) => (pointsThisWeek.get(t.rosterId) ?? 0) > 0)
  // The chop line is only meaningful once the alive field has scores to compare.
  const low = scored.length ? Math.min(...alive.map((t) => pointsThisWeek.get(t.rosterId) ?? 0)) : null
  const standings = alive
    .map((t) => {
      const points = Math.round((pointsThisWeek.get(t.rosterId) ?? 0) * 100) / 100
      return { rosterId: t.rosterId, name: t.name, points, onChopLine: low != null && points === Math.round(low * 100) / 100 }
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))

  const chopped = [...out.entries()]
    .map(([rosterId, w]) => ({ rosterId, name: name(rosterId), week: w }))
    .sort((a, b) => b.week - a.week || a.name.localeCompare(b.name))

  return { week, standings, chopped, teamsAlive: alive.length, scoredThisWeek: scored.length }
}

/**
 * Which Guilly tab the league page shows (app/league/[leagueId]/LeagueShell.tsx): the native one, read from
 * our chop engine, for a league hosted here; the imported one, read from the provider's scores, for an
 * imported Guilly league; none otherwise. An imported league NEVER gets the native tab — it has no chop
 * engine data, and the older rows still flagged `guillotineMode` used to open it and fail.
 */
export function guillyTabKind(
  league: { leagueType?: string | null; leagueVariant?: string | null; guillotineMode?: boolean | null; settings?: unknown },
  native: boolean,
): 'native' | 'imported' | null {
  if (!native) {
    return importedGuillyFormat({ leagueType: league.leagueType ?? null, guillotineMode: league.guillotineMode ?? null, settings: league.settings }) ? 'imported' : null
  }
  return league.guillotineMode === true || league.leagueVariant === 'guillotine' ? 'native' : null
}
