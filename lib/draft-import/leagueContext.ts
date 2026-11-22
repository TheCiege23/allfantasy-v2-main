/**
 * Build league context for import mapping (roster ids and display names). Deterministic.
 */

import type { LeagueImportContext } from './ImportMappingLayer'

function normalize(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

interface LeagueRosterInfo {
  id: string
  displayName: string
}

/**
 * Build import context from league rosters and teams. Match by index (rosters[i] ~ teams[i]).
 */
export function buildLeagueImportContext(
  leagueId: string,
  teamCount: number,
  rounds: number,
  rosters: LeagueRosterInfo[]
): LeagueImportContext {
  const rosterIdToDisplayName: Record<string, string> = {}
  const displayNameToRosterId: Record<string, string> = {}
  const rosterIdsBySlot: string[] = []
  for (let i = 0; i < rosters.length; i++) {
    const r = rosters[i]
    rosterIdsBySlot.push(r.id)
    const name = r.displayName || `Team ${i + 1}`
    rosterIdToDisplayName[r.id] = name
    displayNameToRosterId[normalize(name)] = r.id
  }
  return {
    leagueId,
    teamCount,
    rounds,
    rosterIdToDisplayName,
    displayNameToRosterId,
    rosterIdsBySlot,
  }
}
