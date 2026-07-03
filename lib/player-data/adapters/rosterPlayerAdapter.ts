/**
 * Roster board — merge normalized wire rows into existing roster player shapes (display-only).
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { NflRedraftCanonicalPlayer } from '@/lib/player-data/nflRedraftCanonicalPlayer'

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
  teamLogoUrl?: string | null
  providerInjuryLabel?: string | null
  unifiedProjectedPoints?: number | null
  unifiedLowConfidence?: boolean
  profileSource?: string | null
  statsSource?: string | null
  canonicalNflRedraft?: NflRedraftCanonicalPlayer | null
  playerDataLastUpdatedAt?: string | null
  playerDataWarnings?: string[]
}

export type RosterStateMergeable = Record<RosterSectionKey, RosterPlayerMergeable[]>

function enrichOne(p: RosterPlayerMergeable, byId: Map<string, UnifiedPlayerWireDto>): RosterPlayerMergeable {
  const u = byId.get(p.id)
  if (!u) return p
  const canonical = u.nflRedraft ?? null
  return {
    ...p,
    headshotUrl: canonical?.media.headshot.url ?? u.headshotUrl ?? null,
    teamLogoUrl: canonical?.media.teamLogo.url ?? u.teamLogoUrl ?? null,
    providerInjuryLabel: canonical?.injury.designation ?? u.injuryStatus ?? null,
    unifiedProjectedPoints:
      canonical?.currentProjection.weeklyProjectedPoints != null &&
      Number.isFinite(Number(canonical.currentProjection.weeklyProjectedPoints))
        ? Number(canonical.currentProjection.weeklyProjectedPoints)
        : u.projectedPoints != null && Number.isFinite(Number(u.projectedPoints))
          ? Number(u.projectedPoints)
          : null,
    unifiedLowConfidence: u.lowConfidence === true || Boolean(canonical?.fallbacks.length),
    profileSource: u.profileSource ?? null,
    statsSource: u.statsSource ?? null,
    canonicalNflRedraft: canonical,
    playerDataLastUpdatedAt: canonical?.lastUpdatedAt ?? null,
    playerDataWarnings: canonical?.dataFreshness.staleWarnings ?? [],
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
