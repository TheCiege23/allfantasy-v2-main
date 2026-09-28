/** Per-player deadlines. One Thursday starter does not lock a Sunday lineup. */
export function lineupDeadlines(
  players: ReadonlyArray<{ kickoff: Date | null; issues: number }>,
  empty: number,
  now: number,
) {
  let started = 0
  let unknownKickoffs = 0
  let actionableSeverity = empty
  let next: number | null = null
  let nextFlagged: number | null = null
  for (const player of players) {
    const at = player.kickoff?.getTime()
    if (at == null || !Number.isFinite(at)) {
      unknownKickoffs++
      actionableSeverity += player.issues
    } else if (at <= now) {
      started++
    } else {
      actionableSeverity += player.issues
      next = next == null ? at : Math.min(next, at)
      if (player.issues > 0) nextFlagged = nextFlagged == null ? at : Math.min(nextFlagged, at)
    }
  }
  return {
    started,
    unknownKickoffs,
    actionableSeverity,
    lockAt: nextFlagged ?? next,
    // Unknown schedules, byes and empty slots never establish a whole-lineup lock.
    locked: players.length > 0 && started === players.length && empty === 0,
  }
}
