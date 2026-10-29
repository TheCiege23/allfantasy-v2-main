/**
 * Guillotine league atmosphere (2026-10-18): which mood the themed background takes, and the one
 * status line the league banner shows. Pure, so every state is testable without a page.
 *
 * Inputs are only what the page already has (the league row) plus the existing
 * `/api/leagues/[id]/guillotine/summary` payload, which is DB-only. When the summary is missing
 * (before the draft, a failed request) the mood falls back to `default` and the line is built
 * from the league row alone.
 */

export type GuillotineAtmosphereMood = 'default' | 'chop_week' | 'final' | 'eliminated'

/** The parts of the summary payload this reads (a subset of `GuillotineWeeklySummary` + route extras). */
export type GuillotineAtmosphereSummary = {
  weekOrPeriod?: number | null
  survivalStandings?: { rosterId: string }[] | null
  recentChopEvents?: { weekOrPeriod: number; choppedRosterIds: string[] }[] | null
  myRosterId?: string | null
  config?: { eliminationStartWeek?: number | null; eliminationEndWeek?: number | null } | null
}

export type GuillotineAtmosphereState = {
  mood: GuillotineAtmosphereMood
  /** Teams still alive; the league's team count before any summary exists. */
  alive: number | null
  week: number | null
  firstChopWeek: number | null
  lastChopWeek: number | null
  /** The week the viewer was chopped, when they were. */
  myChopWeek: number | null
}

/**
 * Native guillotine leagues only. A Survivor (or Big Brother) league that also runs guillotine
 * keeps its own atmosphere, so the variant wins over the flag.
 */
export function isGuillotineAtmosphereLeague(league: { leagueVariant?: string | null; guillotineMode?: boolean | null }): boolean {
  const variant = String(league.leagueVariant ?? '').toLowerCase()
  if (variant === 'survivor' || variant === 'big_brother') return false
  return variant === 'guillotine' || league.guillotineMode === true
}

const posInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null

export function deriveGuillotineAtmosphere(input: {
  /** Setup or draft phase (`nativeLeaguePhase`): nothing can be chopped yet. */
  predraft: boolean
  teamCount: number | null
  /** The league row's current week, when it carries one. */
  leagueWeek?: number | null
  summary: GuillotineAtmosphereSummary | null
  /** League.settings — the chop window before a config row exists (getGuillotineConfig's fallback). */
  settings?: Record<string, unknown> | null
}): GuillotineAtmosphereState {
  const { summary } = input
  const firstChopWeek = posInt(summary?.config?.eliminationStartWeek) ?? posInt(input.settings?.eliminationStartWeek)
  const lastChopWeek = posInt(summary?.config?.eliminationEndWeek) ?? posInt(input.settings?.eliminationEndWeek)
  const standings = summary?.survivalStandings
  const alive = standings && standings.length > 0 ? standings.length : posInt(input.teamCount)
  // The summary's week is the latest SCORED week; the league row can be ahead of it mid-week.
  const weeks = [posInt(summary?.weekOrPeriod), posInt(input.leagueWeek)].filter((w): w is number => w != null)
  const week = weeks.length ? Math.max(...weeks) : null
  const events = summary?.recentChopEvents ?? []
  const mine = summary?.myRosterId ? events.find((e) => e.choppedRosterIds.includes(summary.myRosterId!)) : undefined
  const myChopWeek = mine ? mine.weekOrPeriod : null

  const state = { alive, week, firstChopWeek, lastChopWeek, myChopWeek }
  if (myChopWeek != null) return { ...state, mood: 'eliminated' }
  if (input.predraft || !summary || week == null || firstChopWeek == null) return { ...state, mood: 'default' }
  if (lastChopWeek != null && week > lastChopWeek) return { ...state, mood: 'default' }
  if (standings && standings.length > 0 && standings.length <= 2) return { ...state, mood: 'final' }
  if (week < firstChopWeek) return { ...state, mood: 'default' }
  if (lastChopWeek != null && week === lastChopWeek) return { ...state, mood: 'final' }
  const choppedThisWeek = events.some((e) => e.weekOrPeriod === week && e.choppedRosterIds.length > 0)
  return { ...state, mood: choppedThisWeek ? 'default' : 'chop_week' }
}

/** "16 alive · First chop wk 10", "Chop week 12 · 9 alive", "Final chop · wk 17 · 2 alive". */
export function guillotineBannerLine(state: GuillotineAtmosphereState): string {
  const alive = state.alive != null ? `${state.alive} alive` : null
  const parts: (string | null)[] = []
  if (state.mood === 'eliminated') {
    parts.push(`Chopped wk ${state.myChopWeek}`, alive)
  } else if (state.mood === 'final') {
    parts.push(state.week != null ? `Final chop · wk ${state.week}` : 'Final chop', alive)
  } else if (state.mood === 'chop_week') {
    parts.push(`Chop week ${state.week}`, alive)
  } else if (state.week != null && state.firstChopWeek != null && state.week >= state.firstChopWeek) {
    parts.push(alive, state.lastChopWeek != null ? `Last chop wk ${state.lastChopWeek}` : null)
  } else {
    parts.push(alive, state.firstChopWeek != null ? `First chop wk ${state.firstChopWeek}` : null)
  }
  return parts.filter(Boolean).join(' · ')
}
