import { describe, expect, it } from 'vitest'
import { tradeEvidenceFromUnifiedWire, tradeEvidenceBlockForPrompt } from '@/lib/player-data/adapters/tradePlayerContextAdapter'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

function uw(partial: Partial<UnifiedPlayerWireDto>): UnifiedPlayerWireDto {
  return {
    id: 'p',
    name: 'Player',
    position: 'QB',
    team: 'BUF',
    sport: 'NFL',
    headshotUrl: null,
    injuryStatus: 'Probable',
    fantasyPointsPerGame: 18,
    projectedPoints: 20,
    adp: 5,
    aiAdp: 6,
    aiAdpSampleSize: null,
    collegeClass: 'unknown',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: null,
    nflRookieSource: null,
    lowConfidence: true,
    profileSource: 'sleeper',
    statsSource: 'ri',
    projectionsSource: 'ri',
    normalizedStats: { a: 1 },
    normalizedProjections: {},
    product: {
      unified: {
        profileSource: 'sleeper',
        adpSource: 'pool_adp',
        aiAdpSource: 'ai_adp',
        yearsExpSource: 'sleeper_live',
        rookieSource: null,
      } as any,
      yearsExp: 3,
      byeWeek: null,
    },
    ...partial,
  }
}

describe('tradePlayerContextAdapter', () => {
  it('keeps ADP and AI ADP separate', () => {
    const e = tradeEvidenceFromUnifiedWire(uw({ adp: 4, aiAdp: 9 }))
    expect(e.adp).toBe(4)
    expect(e.aiAdp).toBe(9)
  })

  it('includes injury evidence without inventing trade value', () => {
    const block = tradeEvidenceBlockForPrompt([uw({ injuryStatus: 'Out' })], 'Side A')
    expect(block).toContain('injury=Out')
    expect(block.toLowerCase()).not.toContain('tradevalue')
  })

  it('maps injury vs ADP vs AI ADP sources from unified meta', () => {
    const e = tradeEvidenceFromUnifiedWire(uw({ injuryStatus: 'Doubtful', adp: 12, aiAdp: 15 }))
    expect(e.injurySource).toBe('sleeper')
    expect(e.adpSource).toBe('pool_adp')
    expect(e.aiAdpSource).toBe('ai_adp')
    expect(e.experienceSource).toBe('sleeper_live')
  })
})
