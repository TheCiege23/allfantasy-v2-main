/**
 * The C2C / Devy pipeline for one draft year: which of your college players were drafted (they move
 * to your NFL roster as rookies), and how many drafted rookies nobody in the league held in college
 * (they make up the shortened rookie draft).
 *
 * Pure. The caller supplies the draft picks and the league's college rosters, both keyed by CFBD
 * athlete id. The picks come from `cfbd:draft-picks:v1:<year>`, written by
 * lib/devy/cfbdDraftPicksStore.ts (PR #4006). That writer is the shared contract, and
 * `parseStoredDraftPicks` below is the reader's half of it. Nothing is matched by name.
 */

export type PipelinePick = {
  collegeAthleteId: string
  name: string
  position: string
  nflTeam: string
  round: number
  pick: number
  overall: number
}

export type CollegeProPipeline = {
  year: number
  /** Your college players who were drafted. Each one moves to your NFL roster as a rookie. */
  movingUp: Array<{ playerId: string; name: string; position: string; nflTeam: string; round: number; pick: number }>
  /** The shortened rookie draft's pool: drafted players no team in the league held in college. */
  rookiePool: { drafted: number; heldInCollege: number; unheld: number }
}

/** The stored row, or null when it is not one. Tolerant: a malformed pick is skipped, not trusted. */
export function parseStoredDraftPicks(data: unknown): { year: number; picks: PipelinePick[] } | null {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  const year = Number(d?.year)
  if (!d || !Number.isInteger(year) || !Array.isArray(d.picks)) return null
  const picks: PipelinePick[] = []
  for (const raw of d.picks) {
    const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    const id = typeof p?.collegeAthleteId === 'string' ? p.collegeAthleteId.trim() : ''
    const round = Number(p?.round), pick = Number(p?.pick), overall = Number(p?.overall)
    if (!id || !Number.isFinite(round) || !Number.isFinite(pick)) continue
    picks.push({
      collegeAthleteId: id,
      name: String(p?.name ?? ''),
      position: String(p?.position ?? ''),
      nflTeam: String(p?.nflTeam ?? ''),
      round,
      pick,
      overall: Number.isFinite(overall) ? overall : pick,
    })
  }
  return { year, picks }
}

export function buildPipeline(args: {
  year: number
  picks: readonly PipelinePick[]
  /** The viewer's college players: Fantrax id and CFBD athlete id. */
  myPlayers: ReadonlyArray<{ id: string; cfbdId: string | null; name: string }>
  /** Every CFBD athlete id on any college roster in the league, the viewer's included. */
  leagueCfbdIds: ReadonlySet<string>
}): CollegeProPipeline {
  const byAthlete = new Map(args.picks.map((p) => [p.collegeAthleteId, p]))
  const movingUp = args.myPlayers
    .map((p) => {
      const drafted = p.cfbdId ? byAthlete.get(p.cfbdId) : undefined
      return drafted
        ? { playerId: p.id, name: drafted.name || p.name, position: drafted.position, nflTeam: drafted.nflTeam, round: drafted.round, pick: drafted.pick }
        : null
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.round - b.round || a.pick - b.pick)
  const heldInCollege = args.picks.filter((p) => args.leagueCfbdIds.has(p.collegeAthleteId)).length
  return {
    year: args.year,
    movingUp,
    rookiePool: { drafted: args.picks.length, heldInCollege, unheld: args.picks.length - heldInCollege },
  }
}
