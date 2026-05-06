import { describe, expect, it } from 'vitest'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import { buildUnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'

describe('AI player context — provider-prioritized unified payload', () => {
  it('includes normalized stats + low-confidence markers for prompting', () => {
    const entry = normalizeDraftPlayer(
      {
        full_name: 'Context Player',
        position: 'QB',
        team: 'NYJ',
        playerId: 'qb-ctx',
        fantasyPointsPerGame: 17.2,
      },
      'NFL',
    )
    const u = buildUnifiedPlayerProductView(entry).unified
    expect(u.normalizedStats.fantasyPointsPerGame).toBe(17.2)
    expect(typeof u.lowConfidence).toBe('boolean')
  })
})
