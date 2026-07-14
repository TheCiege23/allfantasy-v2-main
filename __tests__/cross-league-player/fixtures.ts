/**
 * Cross-League Player Intelligence phase — shared test fixtures.
 */
import type { ResolutionResult } from '@/lib/shared-services/player-identity'

export function baseRoster(overrides: Partial<{
  leagueId: string
  platformUserId: string
  playerData: unknown
  league: { id: string; name: string | null; platform: string; sport: string; season: number; lastSyncedAt: Date | null; syncStatus: string | null; scoring: string | null }
}> = {}) {
  return {
    leagueId: 'league-1',
    platformUserId: 'user-1',
    playerData: {
      lineup_sections: {
        starters: [{ id: 'p1', name: 'Player One', position: 'RB', team: 'BUF' }],
        bench: [],
        ir: [],
        taxi: [],
        devy: [],
      },
    },
    league: {
      id: 'league-1',
      name: 'Test League',
      platform: 'sleeper',
      sport: 'NFL',
      season: 2026,
      lastSyncedAt: new Date('2026-07-12T00:00:00Z'),
      syncStatus: 'success',
      scoring: 'PPR',
    },
    ...overrides,
  }
}

export function resolutionFor(sourceId: string, overrides: Partial<ResolutionResult> = {}): ResolutionResult {
  return {
    input: { provider: 'sleeper', sourceId },
    player: {
      canonicalPlayerId: `canonical-${sourceId}`,
      canonicalName: `Player ${sourceId}`,
      normalizedName: `player ${sourceId}`,
      position: 'RB',
      team: 'BUF',
      sport: 'NFL',
      providerIds: { sleeper: sourceId },
    },
    confidence: 'direct',
    source: 'player_identity_map_direct',
    resolvedAt: '2026-07-12T00:00:00.000Z',
    diagnostics: { matchedField: 'sleeperId', candidateCount: 1, tiedCandidates: 1, reason: 'direct match' },
    ...overrides,
  }
}
