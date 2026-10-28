/**
 * TRUE MAX PF FOR LEAGUES THAT PLAY ON ALLFANTASY — the most each team could have scored, week by
 * week, had it started its best legal lineup. The rookie order (./rookieOrderEngine.ts) and the
 * lottery rank non-playoff teams by it, because unlike points for it cannot be lowered by benching
 * good players.
 *
 * The optimiser and the season sum are `lib/commissioner-os/efl/maxPfEngine.ts`, the one Sleeper
 * leagues already use; this module only builds its input from what a native week stored:
 *
 *   which players   the lineup the team SAVED for that week — `af_roster_lineup_assignments` rows hold
 *                   the whole roster at save time (starters, bench, IR, taxi, devy). Starters and bench
 *                   may start; IR, taxi and devy may not.
 *                   No save that week → the team's latest earlier save (the lineup it kept); no save at
 *                   all → its current roster, which is what matchup scoring itself used for that week.
 *   their points    the league's own scorer over the stored weekly stat line — the scorer matchups use.
 *                   A player with no stat line that week scored nothing.
 *   the seats       the league's starter slots, with lineup validation's eligibility.
 *
 * Only finished regular-season weeks count. Pure.
 */
import { computeSeasonMaxPf } from '@/lib/commissioner-os/efl/maxPfEngine'
import type { LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import { normalizeToken } from '@/lib/redraft/lineupValidation'

export type SavedWeekRoster = { week: number; playerIds: readonly string[] }

export type NativeMaxPfTeam = {
  teamId: string
  /** Weeks this team saved a lineup for, with the starters and bench of each. */
  saved: readonly SavedWeekRoster[]
  /** Starters and bench now (never IR / taxi / devy). */
  current: readonly string[]
}

export type RosterSource = 'saved' | 'carried' | 'current'

/** The players who could have started for a team in a week (see the header). */
export function rosterForWeek(team: NativeMaxPfTeam, week: number): { playerIds: readonly string[]; source: RosterSource } {
  let latest: SavedWeekRoster | null = null
  for (const s of team.saved) {
    if (s.week === week) return { playerIds: s.playerIds, source: 'saved' }
    if (s.week < week && (!latest || s.week > latest.week)) latest = s
  }
  return latest ? { playerIds: latest.playerIds, source: 'carried' } : { playerIds: team.current, source: 'current' }
}

export function playerPositions(position: string | null | undefined): string[] {
  return String(position ?? '')
    .split(/[/,]/)
    .map((p) => normalizeToken(p))
    .filter(Boolean)
}

export type NativeMaxPfResult = {
  maxPfByTeam: Map<string, number>
  weeks: number[]
  /** Team-weeks read from an earlier week's saved lineup, or from the current roster. */
  carried: number
  fromCurrent: number
}

export function nativeSeasonMaxPf(input: {
  /** Finished regular-season weeks. */
  weeks: readonly number[]
  teams: readonly NativeMaxPfTeam[]
  positionOf: (playerId: string) => string | null
  /** The player's fantasy points that week under league scoring; null when he has no stat line. */
  pointsOf: (playerId: string, week: number) => number | null
  slots: readonly LineupSlotSpec[]
}): NativeMaxPfResult {
  const weeks = [...new Set(input.weeks)].filter((w) => Number.isInteger(w) && w >= 1).sort((a, b) => a - b)
  let carried = 0
  let fromCurrent = 0
  const season = computeSeasonMaxPf({
    regularSeasonFinalWeek: weeks.at(-1) ?? 0,
    slotsForWeek: () => input.slots,
    weeks: weeks.map((week) => ({
      week,
      teams: input.teams.map((team) => {
        const { playerIds, source } = rosterForWeek(team, week)
        if (source === 'carried') carried++
        if (source === 'current') fromCurrent++
        return {
          teamId: team.teamId,
          players: [...new Set(playerIds)].map((playerId) => ({
            playerId,
            positions: playerPositions(input.positionOf(playerId)),
            points: input.pointsOf(playerId, week) ?? 0,
            wasStarter: false,
          })),
        }
      }),
    })),
  })
  const maxPfByTeam = new Map<string, number>(input.teams.map((t) => [t.teamId, 0]))
  for (const v of season.weeklyValues) maxPfByTeam.set(v.teamId, (maxPfByTeam.get(v.teamId) ?? 0) + v.value)
  for (const [id, v] of maxPfByTeam) maxPfByTeam.set(id, Math.round(v * 100) / 100)
  return { maxPfByTeam, weeks, carried, fromCurrent }
}

/** The rookie order's note on where its max PF came from. */
export function nativeMaxPfNote(r: Pick<NativeMaxPfResult, 'weeks' | 'carried' | 'fromCurrent'>): string {
  const base = `Max PF is each team's best possible lineup in each of the ${r.weeks.length} finished regular-season ${r.weeks.length === 1 ? 'week' : 'weeks'}, scored by the league's own rules.`
  const estimated = r.carried + r.fromCurrent
  return estimated > 0
    ? `${base} ${estimated} team-${estimated === 1 ? 'week has' : 'weeks have'} no lineup saved for that week, so the team's previous lineup (or its current roster) stands in.`
    : base
}
