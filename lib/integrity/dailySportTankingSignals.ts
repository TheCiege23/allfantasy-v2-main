/**
 * Tanking signals for the sports whose teams play most days — NBA, NHL and MLB. Pure: no database.
 *
 * 🛑 THE TANKING SCAN ONLY KNEW FOOTBALL'S IDLE STARTER. Its one "this starter cannot score" test was
 * an NFL bye week (`byeWeek === week`), a field these sports never carry, so a manager in a daily
 * sport could start idle players all week and the scan saw nothing. What an idle starter looks like
 * depends on how the league sets lineups:
 *
 *   - DAILY lineups (`isDailyLineupScoringEnabled`): each day is scored on that day's starters. An
 *     IDLE START is a starter whose team has no game that day while a bench player of the same
 *     team, eligible for that slot, does play. One is ordinary carelessness; the scan counts them
 *     over the week and the caller flags at the commissioner's sensitivity
 *     (`TANKING_IDLE_STARTS_PER_WEEK`).
 *   - WEEKLY lineups: a starter scores every game his team plays that week, so the idle starter is
 *     one whose team plays NO game all week — football's bye, and counted the same way.
 *
 * ⚠ AN UNREAD TEAM IS NEVER IDLE. The schedule and the roster can spell a team differently (see
 * `buildWeekKickoffMap`), so a team the week's schedule cannot place (`teamPlays` → null) is no
 * evidence either way, and a player whose slot that day is unknown (no saved lineup) gets no claim.
 * Only positive evidence counts: a team the schedule names, idle on the day, against a bench player
 * the schedule shows playing.
 */

export type IdleStart = {
  /** The Eastern day (`YYYY-MM-DD`), or null for a weekly league's whole week. */
  day: string | null
  playerId: string
  slot: string
  /** An eligible bench player who played that day (daily), or null (weekly: the bye rule needs none). */
  benchPlayerId: string | null
}

export type DailySportPlayer = {
  playerId: string
  position: string | null
  team: string | null
  /** This player's slot on `day`, or null when no saved lineup says (no claim is made then). */
  slotOn: (day: string) => string | null
  /** The days of the week he was on the team. */
  daysOnTeam: readonly string[]
}

const BENCH = new Set(['bn', 'bench'])

function positions(position: string | null): string[] {
  return String(position ?? '')
    .split(/[\/,]/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
}

/**
 * Idle starts for one team's week.
 *
 * `teamPlays(team, day)`: true / false when the week's schedule names the team, null when it cannot
 * place it. With `day` null it answers for the whole week. `isStarterSlot` and `slotAccepts` are the
 * scoring rules' own (`isNflRedraftScoringStarterSlot`, `allowedPositionsForSlot`).
 */
export function findIdleStarts(input: {
  mode: 'daily' | 'weekly'
  days: readonly string[]
  players: readonly DailySportPlayer[]
  teamPlays: (team: string | null, day: string | null) => boolean | null
  isStarterSlot: (slot: string) => boolean
  slotAccepts: (slot: string, position: string) => boolean
}): IdleStart[] {
  const out: IdleStart[] = []
  if (input.mode === 'weekly') {
    // One verdict per starter: the slot he holds on the week's last day he was on the team.
    for (const p of input.players) {
      const day = p.daysOnTeam[p.daysOnTeam.length - 1]
      const slot = day ? p.slotOn(day) : null
      if (!slot || !input.isStarterSlot(slot)) continue
      if (input.teamPlays(p.team, null) === false) out.push({ day: null, playerId: p.playerId, slot, benchPlayerId: null })
    }
    return out
  }
  for (const day of input.days) {
    const present = input.players.filter((p) => p.daysOnTeam.includes(day))
    const bench = present.filter((p) => {
      const slot = p.slotOn(day)
      return slot != null && BENCH.has(slot.trim().toLowerCase()) && input.teamPlays(p.team, day) === true
    })
    for (const p of present) {
      const slot = p.slotOn(day)
      if (!slot || !input.isStarterSlot(slot)) continue
      if (input.teamPlays(p.team, day) !== false) continue
      const alternative = bench.find((b) => positions(b.position).some((pos) => input.slotAccepts(slot, pos)))
      if (alternative) out.push({ day, playerId: p.playerId, slot, benchPlayerId: alternative.playerId })
    }
  }
  return out
}
