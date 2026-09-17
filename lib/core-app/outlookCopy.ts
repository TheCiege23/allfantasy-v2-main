/**
 * Season Outlook — wording and number formats shared by the server loader and the client screens.
 *
 * Client-safe: no I/O and no `server-only`. `describeTeamOutlook` used to live in `seasonOutlook.ts`,
 * which is `server-only`, so the league screen could not become a client component (it needs to,
 * for the scenario panel) without moving it here. `seasonOutlook.ts` re-exports it unchanged.
 */

type TeamOutlookInput = {
  playoffPct: number
  modelled: boolean
  status?: 'clinched' | 'eliminated' | null
}

/**
 * The per-team condition shown in the league-scoped standings table.
 *
 * ⚠ SEPARATE FROM `describeWhatDecidesIt` BECAUSE THE VOICE IS DIFFERENT, NOT
 * BECAUSE THE LOGIC IS. That one is second-person and about the reader; this is
 * third-person and about eleven other people. Reusing it would have printed
 * "you are in" beside another manager's name.
 *
 * Same contract though: a condition, never a status word. "Eliminated with a
 * loss this week" tells you what to watch; "Out of contention" does not.
 */
export function describeTeamOutlook(team: TeamOutlookInput, weeksRemaining: number, playoffTeams: number): string {
  if (!team.modelled) return 'Too few completed weeks to model'
  if (team.status === 'clinched') return weeksRemaining > 0 ? 'Clinched — playing for seeding' : 'In the field'
  if (team.status === 'eliminated') return 'Eliminated — cannot reach the field'
  if (weeksRemaining === 0) {
    return team.playoffPct >= 99 ? 'In the field' : 'Season over, missed out'
  }
  if (team.playoffPct >= 99) return 'Clinched — playing for seeding'
  if (team.playoffPct <= 1) return 'Eliminated in all but a rounding error'
  if (team.playoffPct >= 85) return `In barring a collapse over the last ${weeksRemaining}`
  if (team.playoffPct >= 60) {
    const need = Math.max(1, Math.ceil(weeksRemaining / 3))
    return `Win ${need} of the last ${weeksRemaining}`
  }
  if (team.playoffPct >= 30) {
    const need = Math.max(1, Math.ceil(weeksRemaining / 2))
    return `Needs ${need} of ${weeksRemaining}, and some help`
  }
  if (team.playoffPct >= 5) return `Must win out and get help`
  return `Alive, barely — outside the top ${playoffTeams}`
}

/** A probability for display: `>99`, `<1`, or a whole number. */
export function pct(n: number): string {
  if (n >= 99.5) return '>99'
  if (n > 0 && n < 0.5) return '<1'
  return n.toFixed(0)
}

/** A range for display, e.g. `41–58%`; a single number when the ends round together. */
export function rangeLabel(range: { lo: number; hi: number }): string {
  const lo = pct(range.lo)
  const hi = pct(range.hi)
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`
}

/** Signed points of probability, e.g. `+6.2` / `−3.0`. */
export function signedPts(n: number, digits = 1): string {
  const v = Math.abs(n) < 0.05 ? 0 : n
  const s = Math.abs(v).toFixed(digits)
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function band(p: number): 'high' | 'mid' | 'low' {
  if (p >= 75) return 'high'
  if (p >= 25) return 'mid'
  return 'low'
}

/** "3 minutes ago" style, for a run time the server stamped. Coarse on purpose. */
export function ageLabel(iso: string, nowMs: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'unknown'
  const mins = Math.max(0, Math.round((nowMs - t) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

type BoardLike = { leagues: Array<{ teams: unknown[]; focus: unknown; milestones: unknown }> }

/**
 * The cross-league board as the client screen needs it: each league's `you`, facts and basis, without
 * every other team's rows or a focus block.
 *
 * ⚠ MEASURED, NOT GUESSED: a 42-league board is ~420 KB with every team's schedule, ranges and finish
 * facts, and `SeasonOutlook` is a client component, so all of it was serialized into the page for a
 * table that shows one row per league. The server boards (Standings, Week) still get the full object.
 */
export function slimOutlookForBoard<T extends BoardLike>(board: T): T {
  return {
    ...board,
    leagues: board.leagues.map((l) => ({ ...l, teams: [], focus: null, milestones: null })),
  } as T
}
