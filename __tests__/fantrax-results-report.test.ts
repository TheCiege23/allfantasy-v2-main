// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { FantraxScheduleRow } from '@/lib/league-import/fantrax/fantraxApi'
import {
  buildFantraxResultsReport,
  fantraxMonthResults,
  readFantraxResultsReport,
} from '@/lib/league-import/fantrax/fantraxResultsReport'

function matchup(week: number, away: number, home: number, values: Partial<FantraxScheduleRow> = {}): FantraxScheduleRow {
  return {
    week,
    awayTeam: `Team ${away}`,
    homeTeam: `Team ${home}`,
    awayTeamId: String(away),
    homeTeamId: String(home),
    isPlayoff: false,
    played: true,
    awayScore: 110,
    homeScore: 100,
    ...values,
  }
}

const fetchedAt = new Date('2026-12-04T05:00:00Z')
const input = {
  season: 2026,
  now: fetchedAt,
  position: { state: 'in_progress' as const, period: 3, scoredThrough: 3 },
  info: {
    scoringPeriods: [
      { number: 1, endDate: '2026-12-01T02:00:00Z' },
      { number: 2, endDate: '2026-12-03T02:00:00Z' },
      { number: 3, endDate: '2026-12-10T02:00:00Z' },
    ],
  },
}

describe('Fantrax commissioner results', () => {
  it('preserves 360 matchups across 180 teams, excludes live periods and groups by Eastern close date', () => {
    const largeLeague = Array.from({ length: 180 }, (_, i) => [
      matchup(1, i, (i + 1) % 180),
      matchup(1, i, (i + 3) % 180),
    ]).flat()
    const report = buildFantraxResultsReport({
      ...input,
      publishedRows: [
        ...largeLeague,
        matchup(2, 1, 2, { awayScore: 0, homeScore: 0, isPlayoff: true }),
        matchup(2, 3, 4, { awayScore: null, played: false }),
        matchup(3, 1, 3),
        matchup(9, 5, 6),
      ],
    })
    expect(report?.periods).toEqual([
      { period: 1, endsOn: '2026-11-30', matchups: 360, playoffMatchups: 0, scoreTies: 0 },
      { period: 2, endsOn: '2026-12-02', matchups: 1, playoffMatchups: 1, scoreTies: 1 },
    ])
    expect(fantraxMonthResults(report?.periods ?? [])).toEqual([
      { month: '2026-12', matchups: 1, playoffMatchups: 1, scoreTies: 1 },
      { month: '2026-11', matchups: 360, playoffMatchups: 0, scoreTies: 0 },
    ])
  })

  it('keeps preseason empty, rejects a mismatched season and waits for a source calendar', () => {
    const report = buildFantraxResultsReport({
      ...input,
      now: new Date('2026-11-20'),
      position: { state: 'preseason', period: 1, scoredThrough: 0 },
      publishedRows: [],
    })
    expect(report).toMatchObject({ phase: 'preseason', periods: [] })
    expect(readFantraxResultsReport({ fantraxResultsReport: report }, 2026)).toEqual(report)
    expect(readFantraxResultsReport({ fantraxResultsReport: report }, 2027)).toBeNull()
    expect(readFantraxResultsReport({}, 2026)).toBeNull()
    expect(buildFantraxResultsReport({ ...input, position: null, publishedRows: [] })).toBeNull()
  })
})
