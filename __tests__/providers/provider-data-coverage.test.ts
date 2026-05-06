import { describe, expect, it } from 'vitest'

import {
  aggregatePlayerRecordCoverage,
  filterRowsMissing,
  formatCoverageReport,
  type PlayerRecordCoverageRow,
} from '@/lib/providers/providerDataCoverage'

const sampleRows: PlayerRecordCoverageRow[] = [
  {
    id: '1',
    name: 'A',
    sport: 'NCAAF',
    team: 'UCF',
    position: 'WR',
    stats: {
      regular_season: { passing_yards: 1 },
      class: 'Fr',
      position_category: 'OFF',
    },
    projections: {},
    headshotUrl: null,
    headshotUrlLg: null,
  },
  {
    id: '2',
    name: 'B',
    sport: 'NCAAF',
    team: 'UCF',
    position: 'RB',
    stats: {},
    projections: {},
    headshotUrl: null,
    headshotUrlLg: null,
  },
  {
    id: '3',
    name: 'C',
    sport: 'NCAAF',
    team: 'ALA',
    position: 'DL',
    stats: {
      position_category: 'DEF',
      regular_season: { points: 1, sacks: 2, points_against_defense_special_teams: 3 },
    },
    projections: { game_ID: 'g1', away_team_ID: 'a', home_team_ID: 'h' },
    headshotUrl: null,
    headshotUrlLg: null,
  },
]

describe('providerDataCoverage', () => {
  it('aggregates stats/projections/rookie/class counts', () => {
    const agg = aggregatePlayerRecordCoverage(sampleRows, 'NCAAF')
    expect(agg.total).toBe(3)
    expect(agg.withStatsJson).toBeGreaterThanOrEqual(1)
    expect(agg.playersWithCollegeClass).toBeGreaterThanOrEqual(1)
    expect(agg.playersFreshman).toBeGreaterThanOrEqual(1)
    expect(agg.playersWithOffenseCategory).toBeGreaterThanOrEqual(1)
    expect(agg.playersWithDefenseCategory).toBeGreaterThanOrEqual(1)
    expect(agg.rowsWithScheduleSignals).toBeGreaterThanOrEqual(1)
    expect(agg.rowsWithTeamSeasonStatSignals).toBeGreaterThanOrEqual(1)
    expect(formatCoverageReport(agg, 'NCAAF')).toContain('primaryProvider=')
    expect(formatCoverageReport(agg, 'NCAAF')).toContain('posCat(off/def/st)=')
  })

  it('filterRowsMissing class finds rows without class in JSON', () => {
    const miss = filterRowsMissing(sampleRows, 'class', 'NCAAF')
    expect(miss.some((r) => r.id === '2')).toBe(true)
  })

  it('filterRowsMissing schedule / team_stats for NCAAFB signal heuristics', () => {
    const missSched = filterRowsMissing(sampleRows, 'schedule', 'NCAAFB')
    expect(missSched.some((r) => r.id === '1')).toBe(true)
    const missTs = filterRowsMissing(sampleRows, 'team_stats', 'NCAAFB')
    expect(missTs.some((r) => r.id === '2')).toBe(true)
  })

  it('NCAAF aggregate exposes zeroed soccer counters', () => {
    const agg = aggregatePlayerRecordCoverage(sampleRows, 'NCAAF')
    expect(agg.soccerWithPlayerId).toBe(0)
    expect(agg.soccerLeagueFilter).toBeNull()
  })

  it('SOCCER aggregate counts ri league + player_id', () => {
    const soccerRows: PlayerRecordCoverageRow[] = [
      {
        id: 's1',
        name: 'Saka',
        sport: 'SOCCER',
        team: 'ARS',
        position: 'F',
        stats: { player_id: 'p1', league: 'EPL' },
        projections: { status: 'replaced' },
        headshotUrl: null,
        headshotUrlLg: null,
      },
    ]
    const agg = aggregatePlayerRecordCoverage(soccerRows, 'SOCCER', { soccerLeague: 'EPL' })
    expect(agg.total).toBe(1)
    expect(agg.soccerWithPlayerId).toBe(1)
    expect(agg.soccerWithLeagueKey).toBe(1)
    expect(agg.soccerReplacedStatusHits).toBeGreaterThanOrEqual(1)
    expect(formatCoverageReport(agg, 'SOCCER')).toContain('soccerLeagueFilter=EPL')
  })
})
