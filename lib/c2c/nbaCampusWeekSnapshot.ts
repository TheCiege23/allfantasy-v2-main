import { campusStarterIds, collegePlayerIds } from '@/lib/c2c/campusLineup'
import type { CurrentCollegeAthlete } from '@/lib/devy/ncaabRosterEvidence'

export type NbaCampusWeekPlayer = { id: string; espnId: string; teamId: string; position: string; observedAt: string; selectedAt: string }
export type NbaCampusWeekSnapshot = { season: number; week: number; savedAt: string; players: NbaCampusWeekPlayer[] }

/** Preserve a selected player's school for this week even when a later roster refresh observes a transfer. */
export function buildNbaCampusWeekSnapshot(input: {
  playerData: unknown; season: number; week: number; now: Date
  evidence: readonly CurrentCollegeAthlete[]; previous?: NbaCampusWeekSnapshot | null
}): { snapshot: NbaCampusWeekSnapshot | null; missing: string[] } {
  const starters = campusStarterIds(input.playerData)
  const owned = collegePlayerIds(input.playerData)
  const byId = new Map(input.evidence.map(a => [a.id, a]))
  const old = input.previous?.season === input.season && input.previous.week === input.week ? new Map(input.previous.players.map(p => [p.id, p])) : new Map<string, NbaCampusWeekPlayer>()
  const players: NbaCampusWeekPlayer[] = [], missing: string[] = []
  for (const id of starters) {
    if (!owned.has(id)) { missing.push(id); continue }
    const previous = old.get(id)
    if (previous && previous.id === `espn:ncaab:${previous.espnId}` && /^\d+$/.test(previous.espnId) && /^\d+$/.test(previous.teamId) && previous.position && Number.isFinite(new Date(previous.observedAt).getTime()) && Number.isFinite(new Date(previous.selectedAt).getTime())) { players.push(previous); continue }
    const athlete = byId.get(id)
    if (!athlete || !/^\d+$/.test(athlete.espnId) || !/^\d+$/.test(athlete.teamId) || athlete.id !== `espn:ncaab:${athlete.espnId}`) { missing.push(id); continue }
    players.push({ id, espnId: athlete.espnId, teamId: athlete.teamId, position: athlete.position, observedAt: athlete.observedAt.toISOString(), selectedAt: input.now.toISOString() })
  }
  if (missing.length || !Number.isInteger(input.season) || !Number.isInteger(input.week) || input.week < 1) return { snapshot: null, missing }
  return { snapshot: { season: input.season, week: input.week, savedAt: input.now.toISOString(), players }, missing: [] }
}
