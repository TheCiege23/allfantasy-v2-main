/**
 * "Where your starters come from" — across every roster of yours, the NFL clubs your starting
 * QB/RB/WR/TE slots belong to, and the upcoming bye week that empties the most of them at once.
 *
 * Pure, client-safe. Built in playerShares.ts from the same roster read as "Your shares".
 *
 * ⚠ NO CONCENTRATION THRESHOLD. "Too many Bills" has no correct number — it depends on how many
 * leagues you play and whether you stack on purpose. What does have a correct number is the week one
 * bye takes out the most of your lineups, so that is the only thing called out; the club split itself
 * is shown as plain shares.
 *
 * ⚠ A START IS A LINEUP SLOT, NOT A PLAYER. Josh Allen starting in nine leagues is nine slots; the
 * split is over slots, because a bye empties slots. Bench and IR are not counted — a bye there costs
 * nothing.
 *
 * ⚠ AN UNKNOWN CLUB STAYS IN THE DENOMINATOR. A starter whose club we cannot read is still one of your
 * slots, so leaving him out would inflate every share; he is counted as "club not on file" instead.
 */

export const TEAM_SPLIT_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
export const TEAMS_SHOWN = 6
/** Names listed per club, most starts first. */
export const PLAYERS_PER_TEAM = 3

export type SplitStarter = { sleeperId: string; name: string; team: string | null; position: string | null; starts: number }

export type TeamShare = { team: string; starts: number; share: number; players: string[] }

export type ByeCrunch = { week: number; starts: number; share: number; teams: string[] }

export type TeamSplit = {
  /** Every starting QB/RB/WR/TE slot across your rosters, including those whose club is unknown. */
  totalStarts: number
  teams: TeamShare[]
  /** Clubs beyond the ones shown, and the slots they hold. */
  others: { teams: number; starts: number }
  unknownStarts: number
  /** The upcoming week one set of byes empties the most slots in; null when none ahead or byes unknown. */
  worstBye: ByeCrunch | null
  /** False when the bye weeks or the current week could not be read — the card then says so. */
  byesKnown: boolean
}

export function buildTeamSplit(args: {
  starters: readonly SplitStarter[]
  /** Club → bye week (resolveByeWeekMap). Null when it could not be read. */
  byes: Readonly<Record<string, number>> | null
  currentWeek: number | null
  fold: (team: string) => string | null
}): TeamSplit | null {
  const byTeam = new Map<string, { starts: number; players: Array<{ name: string; starts: number }> }>()
  let unknownStarts = 0
  for (const s of args.starters) {
    const pos = String(s.position ?? '').toUpperCase()
    if (!(TEAM_SPLIT_POSITIONS as readonly string[]).includes(pos) || !(s.starts > 0)) continue
    const team = s.team ? args.fold(s.team) : null
    if (!team) {
      unknownStarts += s.starts
      continue
    }
    const e = byTeam.get(team) ?? { starts: 0, players: [] }
    e.starts += s.starts
    e.players.push({ name: s.name, starts: s.starts })
    byTeam.set(team, e)
  }
  const known = [...byTeam.values()].reduce((n, e) => n + e.starts, 0)
  const totalStarts = known + unknownStarts
  if (totalStarts === 0) return null

  const ranked = [...byTeam.entries()].sort((a, b) => b[1].starts - a[1].starts || a[0].localeCompare(b[0]))
  const teams: TeamShare[] = ranked.slice(0, TEAMS_SHOWN).map(([team, e]) => ({
    team,
    starts: e.starts,
    share: e.starts / totalStarts,
    players: [...e.players].sort((a, b) => b.starts - a.starts || a.name.localeCompare(b.name)).slice(0, PLAYERS_PER_TEAM).map((p) => p.name),
  }))
  const rest = ranked.slice(TEAMS_SHOWN)
  const others = { teams: rest.length, starts: rest.reduce((n, [, e]) => n + e.starts, 0) }

  const byesKnown = args.byes != null && args.currentWeek != null && Object.keys(args.byes).length > 0
  let worstBye: ByeCrunch | null = null
  if (byesKnown) {
    const byWeek = new Map<number, string[]>()
    for (const [team, week] of Object.entries(args.byes!)) {
      if (week < args.currentWeek!) continue // a bye already played is history
      const club = args.fold(team)
      if (!club || !byTeam.has(club)) continue
      byWeek.set(week, [...(byWeek.get(week) ?? []), club])
    }
    for (const [week, clubs] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
      const starts = clubs.reduce((n, c) => n + (byTeam.get(c)?.starts ?? 0), 0)
      if (starts > 0 && (!worstBye || starts > worstBye.starts)) {
        worstBye = { week, starts, share: starts / totalStarts, teams: [...clubs].sort((a, b) => (byTeam.get(b)?.starts ?? 0) - (byTeam.get(a)?.starts ?? 0) || a.localeCompare(b)) }
      }
    }
  }

  return { totalStarts, teams, others, unknownStarts, worstBye, byesKnown }
}
