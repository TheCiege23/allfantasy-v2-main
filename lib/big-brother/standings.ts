import { resolveMemoryWallStatus, type MemoryWallStatus } from './memoryWallStatus'

export interface StandingsCycle {
  week: number
  phase: string
  hohRosterId: string | null
  vetoWinnerRosterId: string | null
  vetoParticipantRosterIds?: string[] | null
  nominee1RosterId: string | null
  nominee2RosterId: string | null
  vetoUsed: boolean
  vetoSavedRosterId: string | null
  replacementNomineeRosterId: string | null
  evictedRosterId: string | null
  closedAt: Date | string | null
}

export interface BigBrotherStanding {
  rosterId: string
  teamName: string
  status: MemoryWallStatus | 'WINNER' | 'FINALIST' | 'AWAITING_START'
  place: number | null
  hohWins: number
  vetoWins: number
  timesNominated: number
  evictedWeek: number | null
  processedPoints: number | null
  scoredWeeks: number
}

export interface BigBrotherStandings {
  leagueId: string
  season: number
  state: 'setup' | 'active' | 'finale' | 'completed'
  week: number | null
  phase: string | null
  viewerRosterId: string | null
  winnerRosterId: string | null
  remainingCount: number
  juryCount: number
  rows: BigBrotherStanding[]
  history: Array<{ week: number; hohRosterId: string | null; vetoWinnerRosterId: string | null; evictedRosterId: string | null }>
}

/** Read model only. Neither fantasy points nor competition wins decide season placement. */
export function buildBigBrotherStandings(input: {
  leagueId: string
  season: number
  rosters: Array<{ id: string; teamName: string }>
  cycles: StandingsCycle[]
  juryRosterIds: string[]
  finaleSize: number
  winnerRosterId: string | null
  viewerRosterId: string | null
  scores: Array<{ rosterId: string; week: number; totalPoints: number }>
}): BigBrotherStandings {
  const cycles = [...input.cycles].sort((a, b) => a.week - b.week)
  const current = cycles.at(-1) ?? null
  const rosterIds = new Set(input.rosters.map(r => r.id))
  const evictions = new Map<string, number>()
  for (const c of cycles) {
    // Same authority as the engine's eviction guard; no inference from nominations or votes.
    if (c.evictedRosterId && rosterIds.has(c.evictedRosterId) && !evictions.has(c.evictedRosterId)) {
      evictions.set(c.evictedRosterId, c.week)
    }
  }
  const remainingCount = input.rosters.length - evictions.size
  const jury = new Set(input.juryRosterIds.filter(id => evictions.has(id)))
  // Only the engine's published tally is a winner, never live private finale ballots.
  const winner = input.winnerRosterId && rosterIds.has(input.winnerRosterId) && !evictions.has(input.winnerRosterId)
    && cycles.length > 0 && remainingCount <= input.finaleSize ? input.winnerRosterId : null
  const state = winner ? 'completed' : !current ? 'setup'
    : remainingCount > 0 && remainingCount <= input.finaleSize ? 'finale' : 'active'
  const nominations = current ? [current.nominee1RosterId, current.nominee2RosterId]
    .filter((id): id is string => Boolean(id) && !(current.vetoUsed && id === current.vetoSavedRosterId)) : []
  if (current?.vetoUsed && current.replacementNomineeRosterId) nominations.push(current.replacementNomineeRosterId)
  // After an eviction, last cycle's HOH/block badges are history, not current power.
  const openCycle = current && !current.evictedRosterId && !current.closedAt ? current : null
  const evictionOrder = [...evictions.keys()]
  const rows = input.rosters.map((r): BigBrotherStanding => {
    const evictedWeek = evictions.get(r.id) ?? null
    const scores = input.scores.filter(s => s.rosterId === r.id && Number.isFinite(s.totalPoints))
    const status = winner === r.id ? 'WINNER' : evictedWeek !== null
      ? resolveMemoryWallStatus({ rosterId: r.id, cycle: null, finalNomineeRosterIds: [], eliminatedRosterIds: evictionOrder, juryRosterIds: [...jury] })
      : state === 'setup' ? 'AWAITING_START' : state === 'finale' || state === 'completed' ? 'FINALIST'
      : resolveMemoryWallStatus({ rosterId: r.id, cycle: openCycle ? { ...openCycle, vetoParticipantRosterIds: openCycle.vetoParticipantRosterIds ?? null } : null,
          finalNomineeRosterIds: openCycle ? nominations : [], eliminatedRosterIds: [], juryRosterIds: [] })
    return {
      rosterId: r.id, teamName: r.teamName, status,
      place: winner === r.id ? 1 : evictedWeek !== null ? input.rosters.length - evictionOrder.indexOf(r.id) : null,
      hohWins: cycles.filter(c => c.hohRosterId === r.id).length,
      vetoWins: cycles.filter(c => c.vetoWinnerRosterId === r.id).length,
      timesNominated: cycles.filter(c => [c.nominee1RosterId, c.nominee2RosterId, c.replacementNomineeRosterId].includes(r.id)).length,
      evictedWeek, processedPoints: scores.length ? scores.reduce((sum, s) => sum + s.totalPoints, 0) : null,
      scoredWeeks: new Set(scores.map(s => s.week)).size,
    }
  }).sort((a, b) => {
    if (a.status === 'WINNER' || b.status === 'WINNER') return a.status === 'WINNER' ? -1 : 1
    if ((a.evictedWeek === null) !== (b.evictedWeek === null)) return a.evictedWeek === null ? -1 : 1
    return (a.place ?? 0) - (b.place ?? 0) || a.teamName.localeCompare(b.teamName) || a.rosterId.localeCompare(b.rosterId)
  })
  return {
    leagueId: input.leagueId, season: input.season, state, week: current?.week ?? null, phase: current?.phase ?? null,
    viewerRosterId: input.viewerRosterId, winnerRosterId: winner, remainingCount, juryCount: jury.size, rows,
    history: cycles.map(c => ({ week: c.week, hohRosterId: c.hohRosterId, vetoWinnerRosterId: c.vetoWinnerRosterId, evictedRosterId: c.evictedRosterId })).reverse(),
  }
}
