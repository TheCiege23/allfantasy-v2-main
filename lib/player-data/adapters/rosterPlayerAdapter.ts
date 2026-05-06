/**
 * Roster board — merge normalized wire rows into existing roster player shapes (display-only).
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

export type RosterSectionKey = 'starters' | 'bench' | 'ir' | 'taxi' | 'devy'

/** Minimal row shape merged by id — matches useRosterManager `RosterPlayer` + optional enrichments */
export type RosterPlayerMergeable = {
  id: string
  name: string
  team: string
  position: string
  opponent: string
  gameTime: string
  projection: number
  actual: number | null
  status: 'healthy' | 'q' | 'out' | 'ir'
  slot: RosterSectionKey
  headshotUrl?: string | null
  providerInjuryLabel?: string | null
  unifiedProjectedPoints?: number | null
  unifiedLowConfidence?: boolean
  profileSource?: string | null
  statsSource?: string | null
}

export type RosterStateMergeable = Record<RosterSectionKey, RosterPlayerMergeable[]>

function enrichOne(p: RosterPlayerMergeable, byId: Map<string, UnifiedPlayerWireDto>): RosterPlayerMergeable {
  const u = byId.get(p.id)
  if (!u) return p
  return {
    ...p,
    headshotUrl: u.headshotUrl ?? null,
    providerInjuryLabel: u.injuryStatus ?? null,
    unifiedProjectedPoints:
      u.projectedPoints != null && Number.isFinite(Number(u.projectedPoints))
        ? Number(u.projectedPoints)
        : null,
    unifiedLowConfidence: u.lowConfidence === true,
    profileSource: u.profileSource ?? null,
    statsSource: u.statsSource ?? null,
  }
}

function mapSection(
  players: RosterPlayerMergeable[],
  byId: Map<string, UnifiedPlayerWireDto>,
): RosterPlayerMergeable[] {
  return players.map((p) => enrichOne(p, byId))
}

/**
 * Non-destructive: same ids/slots/order; adds unified fields when player id matches `unifiedRoster`.
 */
export function mergeUnifiedIntoRosterState<T extends RosterStateMergeable>(state: T, unifiedRoster: UnifiedPlayerWireDto[] | null | undefined): T {
  const byId = new Map<string, UnifiedPlayerWireDto>()
  for (const row of unifiedRoster ?? []) {
    if (row?.id) byId.set(String(row.id), row)
  }
  const sections: RosterSectionKey[] = ['starters', 'bench', 'ir', 'taxi', 'devy']
  const out = { ...state }
  for (const key of sections) {
    out[key] = mapSection(state[key], byId) as T[typeof key]
  }
  return out
}
