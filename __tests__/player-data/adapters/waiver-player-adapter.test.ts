import { describe, expect, it } from 'vitest'
import { adaptWaiverWirePlayer } from '@/lib/player-data/adapters/waiverPlayerAdapter'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

function wire(partial: Partial<UnifiedPlayerWireDto>): UnifiedPlayerWireDto {
  return {
    id: 'x',
    name: 'A',
    position: 'WR',
    team: 'KC',
    sport: 'NFL',
    headshotUrl: null,
    injuryStatus: 'Questionable',
    fantasyPointsPerGame: null,
    projectedPoints: 11.2,
    adp: 45,
    aiAdp: 40,
    aiAdpSampleSize: null,
    collegeClass: 'unknown',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: null,
    nflRookieSource: null,
    lowConfidence: false,
    profileSource: 'ri',
    statsSource: 'ri',
    projectionsSource: 'ri',
    normalizedStats: {},
    normalizedProjections: {},
    product: { unified: {} as UnifiedPlayerWireDto['product']['unified'], yearsExp: 2, isRookie: false, byeWeek: null },
    ...partial,
  }
}

describe('waiverPlayerAdapter', () => {
  it('preserves wire fields and adds display aliases', () => {
    const row = adaptWaiverWirePlayer(wire({ headshotUrl: 'https://example.com/a.jpg' }))
    expect(row.id).toBe('x')
    expect(row.displayHeadshotUrl).toBe('https://example.com/a.jpg')
    expect(row.displayInjury).toBe('Questionable')
    expect(row.displayProjection).toBe(11.2)
  })

  it('computes experience summary from yearsExp', () => {
    const row = adaptWaiverWirePlayer(wire({ product: { unified: {} as any, yearsExp: 0, isRookie: true, byeWeek: null } }))
    expect(row.experienceSummary).toBe('Rookie')
  })
})
