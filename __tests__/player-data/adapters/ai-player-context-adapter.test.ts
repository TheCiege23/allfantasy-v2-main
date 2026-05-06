import { describe, expect, it } from 'vitest'
import { buildAiUnifiedPlayerBullets } from '@/lib/player-data/adapters/aiPlayerContextAdapter'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

function uw(partial: Partial<UnifiedPlayerWireDto>): UnifiedPlayerWireDto {
  return {
    id: 'p',
    name: 'Player',
    position: 'TE',
    team: 'SF',
    sport: 'NFL',
    headshotUrl: null,
    injuryStatus: null,
    fantasyPointsPerGame: null,
    projectedPoints: null,
    adp: 80,
    aiAdp: 90,
    aiAdpSampleSize: null,
    collegeClass: 'unknown',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: null,
    nflRookieSource: null,
    lowConfidence: false,
    profileSource: 'tsdb',
    statsSource: 'ri',
    projectionsSource: null,
    normalizedStats: {},
    normalizedProjections: {},
    product: { unified: {} as any, yearsExp: null, byeWeek: null },
    ...partial,
  }
}

describe('aiPlayerContextAdapter', () => {
  it('includes source metadata and keeps ADP lines separate', () => {
    const text = buildAiUnifiedPlayerBullets([uw({})], 4)
    expect(text).toContain('adp=80')
    expect(text).toContain('aiAdp=90')
    expect(text).toContain('profile=tsdb')
  })
})
