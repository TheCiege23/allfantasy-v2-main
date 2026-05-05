import { describe, expect, it } from 'vitest'
import { summarizePlayerMismatchForAi } from '@/lib/player-identity/playerMismatchLogger'

describe('summarizePlayerMismatchForAi', () => {
  it('returns prompt-ready one-liner with core fields', () => {
    const s = summarizePlayerMismatchForAi({
      sport: 'NFL',
      reason: 'ID_DRIFT_STRICT_MATCH_USED',
      playerName: 'Test Player',
      position: 'QB',
      team: 'DAL',
      poolExternalId: 'old-ext',
      attemptedMatchType: 'strict',
      confidence: 0.9,
    })
    expect(s).toContain('ID_DRIFT_STRICT_MATCH_USED')
    expect(s).toContain('sport=NFL')
    expect(s).toContain('player=Test Player')
    expect(s).toContain('confidence=0.9')
  })
})
