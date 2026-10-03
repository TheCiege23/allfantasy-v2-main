import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * What your roster needs from the wire this week and in the weeks just ahead — the context the
 * "Worth adding" list is ranked inside. Pure; `loadWaiverBoard` does the reads.
 *
 * Three facts, each something the reader can check against their own roster, none a judgement:
 *
 * - EMPTY SLOTS: starting slots your best lineup cannot fill this week (a bye, an injury, a position
 *   you do not roster). These are where a free agent's gain is largest.
 * - NO BACKUP: a position whose dedicated starting slots use every player you roster there, so one
 *   bye or injury empties a slot. Only QB/RB/WR/TE — nobody rosters a second kicker on purpose.
 * - BYES: rostered players whose team has no game in this or the next few weeks, from the NFL
 *   schedule on file. ⚠ A WEEK WITH NO GAMES ON FILE IS SKIPPED, NOT REPORTED AS EVERYONE ON BYE.
 */

export type RosterNeedPlayer = {
  id: string
  name: string
  position: string | null
  team: string | null
  starter: boolean
}

export type RosterNeeds = {
  /** The week the empty slots describe. */
  week: number | null
  emptySlots: string[]
  noBackup: Array<{ position: string; rostered: number; starting: number }>
  byes: Array<{ week: number; players: Array<Omit<RosterNeedPlayer, 'id'> & { id: string }> }>
}

const BACKUP_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

export function rosterNeeds(args: {
  week: number | null
  slots: readonly string[]
  unfilled: readonly string[]
  players: readonly RosterNeedPlayer[]
  /** Teams with a game, per week — only weeks whose schedule is on file. */
  teamsPlayingByWeek: ReadonlyMap<number, ReadonlySet<string>>
}): RosterNeeds {
  const pos = (p: string | null) => (p ?? '').trim().toUpperCase()

  const noBackup: RosterNeeds['noBackup'] = []
  for (const position of BACKUP_POSITIONS) {
    const starting = args.slots.filter((s) => s.trim().toUpperCase() === position).length
    if (starting === 0) continue
    const rostered = args.players.filter((p) => pos(p.position) === position).length
    if (rostered <= starting) noBackup.push({ position, rostered, starting })
  }

  const byes: RosterNeeds['byes'] = []
  for (const week of [...args.teamsPlayingByWeek.keys()].sort((a, b) => a - b)) {
    const playing = args.teamsPlayingByWeek.get(week)!
    if (playing.size === 0) continue
    const out = args.players.filter((p) => {
      const team = p.team ? (normalizeTeamAbbrev(p.team) ?? p.team.toUpperCase()) : null
      /* No team on file (a free agent stashed on IR, say) is not a bye — it is an unknown. */
      return team != null && !playing.has(team)
    })
    if (out.length > 0) {
      byes.push({ week, players: out.sort((a, b) => Number(b.starter) - Number(a.starter) || a.name.localeCompare(b.name)) })
    }
  }

  return { week: args.week, emptySlots: [...args.unfilled], noBackup, byes }
}
