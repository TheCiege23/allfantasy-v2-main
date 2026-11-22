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

  it('adds source labels, ADP aliases, bye week, and stats summary for player cards', () => {
    const row = adaptWaiverWirePlayer(
      wire({
        adp: 18.4,
        aiAdp: null,
        projectionsSource: 'allfantasy:rolling_insights',
        statsSource: 'rolling_insights',
        normalizedStats: {
          fantasyPointsPerGame: 14.2,
          receivingYards: 870,
          receivingTouchdowns: 6,
        },
        product: { unified: {} as any, yearsExp: 3, isRookie: false, byeWeek: 10 },
      }),
    )

    expect(row.displayAdp).toBe(18.4)
    expect(row.displayAiAdp).toBeNull()
    expect(row.displayByeWeek).toBe(10)
    expect(row.projectionSourceLabel).toBe('Projection: AF rolling insights')
    expect(row.adpSourceLabel).toBe('Provider ADP')
    expect(row.statsSourceLabel).toBe('Stats: rolling insights')
    expect(row.dataQualityLabels).toContain('Provider ADP')
    expect(row.dataQualityLabels).toContain('AF ADP coming soon')
    expect(row.seasonStatsSummary).toEqual(['PPG 14.2', 'YDS 870', 'TD 6'])
  })

  it('labels NCAAF limited data without inventing missing stats', () => {
    const row = adaptWaiverWirePlayer(
      wire({
        sport: 'NCAAF',
        adp: null,
        projectedPoints: null,
        lowConfidence: true,
        statsSource: null,
        projectionsSource: null,
        normalizedStats: {},
      }),
    )

    expect(row.displayProjection).toBeNull()
    expect(row.dataQualityLabels).toContain('NCAAF limited data')
    expect(row.dataQualityLabels).toContain('Missing stats')
    expect(row.dataQualityLabels).toContain('Fallback projection')
    expect(row.seasonStatsSummary).toEqual([])
  })

  it('a missing fantasy PPG is not printed as "PPG 0"', () => {
    const row = adaptWaiverWirePlayer(wire({ normalizedStats: { fantasyPointsPerGame: null, adp: null } }))
    expect(row.seasonStatsSummary).toEqual([])
  })

  it('NBA: reads sports_players season totals as per-game lines', () => {
    const row = adaptWaiverWirePlayer(
      wire({
        sport: 'NBA',
        position: 'PG',
        normalizedStats: { fantasyPointsPerGame: null, cacheStats: { points: 865, total_rebounds: 245, assists: 322, games_played: 54 } },
      }),
    )
    expect(row.seasonStatsSummary).toEqual(['PTS/G 16', 'REB/G 4.5', 'AST/G 6'])
  })

  it('NBA: no games played means no per-game line, never a total labelled as a rate', () => {
    const row = adaptWaiverWirePlayer(wire({ sport: 'NBA', normalizedStats: { cacheStats: { points: 865 } } }))
    expect(row.seasonStatsSummary).toEqual([])
  })

  it('NFL: reads sports_players season totals, skipping zeros and summing touchdowns', () => {
    const row = adaptWaiverWirePlayer(
      wire({
        sport: 'NFL',
        position: 'QB',
        normalizedStats: {
          cacheStats: { passing_yards: 3800, passing_touchdowns: 28, rushing_yards: 0, rushing_touchdowns: 2, receiving_yards: 0, games_played: 17 },
        },
      }),
    )
    expect(row.seasonStatsSummary).toEqual(['PASS YDS 3800', 'TD 30'])
  })

  it('NHL and MLB lines use each sport\'s own headline counts', () => {
    expect(adaptWaiverWirePlayer(wire({ sport: 'NHL', normalizedStats: { cacheStats: { goals: 31, assists: 40, shots_on_goal: 210 } } })).seasonStatsSummary).toEqual(['G 31', 'A 40', 'SOG 210'])
    expect(adaptWaiverWirePlayer(wire({ sport: 'MLB', position: 'SP', normalizedStats: { cacheStats: { 'pitching.ERA': 3.214, 'pitching.K': 190, 'pitching.W': 12 } } })).seasonStatsSummary).toEqual(['ERA 3.21', 'K 190', 'W 12'])
  })
})
