import { describe, expect, it } from 'vitest'
import { mergeUnifiedIntoRosterState } from '@/lib/player-data/adapters/rosterPlayerAdapter'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

function rp(id: string) {
  return {
    id,
    name: id,
    team: 'DAL',
    position: 'RB',
    opponent: '@NYG',
    gameTime: 'Sun 1pm',
    projection: 10,
    actual: null,
    status: 'healthy' as const,
    slot: 'starters' as const,
  }
}

function uw(id: string): UnifiedPlayerWireDto {
  return {
    id,
    name: 'X',
    position: 'RB',
    team: 'DAL',
    sport: 'NFL',
    headshotUrl: 'https://example.com/h.png',
    injuryStatus: 'Q',
    fantasyPointsPerGame: null,
    projectedPoints: 12,
    adp: null,
    aiAdp: null,
    aiAdpSampleSize: null,
    collegeClass: 'unknown',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: null,
    nflRookieSource: null,
    lowConfidence: false,
    profileSource: null,
    statsSource: null,
    projectionsSource: null,
    normalizedStats: {},
    normalizedProjections: {},
    product: { unified: {} as any, yearsExp: null, byeWeek: null },
  }
}

describe('rosterPlayerAdapter', () => {
  it('merges unified headshot by player id without reordering', () => {
    const state = {
      starters: [rp('a')],
      bench: [rp('b')],
      ir: [],
      taxi: [],
      devy: [],
    }
    const next = mergeUnifiedIntoRosterState(state, [uw('a')])
    expect(next.starters[0]!.headshotUrl).toBe('https://example.com/h.png')
    expect(next.bench[0]!.headshotUrl).toBeUndefined()
  })
})
