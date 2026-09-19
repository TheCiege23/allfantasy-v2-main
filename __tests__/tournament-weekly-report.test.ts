import { describe, expect, it } from 'vitest'
import { buildWeeklyReport, reportTsv } from '@/lib/tournament/weeklyReport'
import type { StandingsBoard } from '@/lib/tournament/standingsBoard'

describe('weekly tournament report', () => {
  const row = { displayName: 'Manager', externalRosterId: '3', unmatched: false, standing: 'in', conferenceRank: 1, wins: 2, losses: 1, ties: 0, pointsFor: 450 }
  const board = { name: 'Cup', roundNumber: 1, conferences: [
    { name: 'Black', leagues: [{ name: 'League A', leagueId: 'a', rows: [row, { ...row, displayName: 'Missing', externalRosterId: '4' }] }] },
    { name: 'Gold', leagues: [{ name: 'League B', leagueId: 'b', rows: [{ ...row, displayName: '=formula\tname' }, { ...row, unmatched: true, displayName: 'Unmatched' }] }] },
  ] } as unknown as StandingsBoard
  const report = buildWeeklyReport(board, 2026, 2, [{ id: 'a', platformLeagueId: 'source-a' }, { id: 'b', platformLeagueId: 'source-b' }], [
    { leagueId: 'source-a', rosterId: '3', pointsFor: 0, updatedAt: '2026-09-19' },
    { leagueId: 'source-b', rosterId: '3', pointsFor: 170.25, updatedAt: '2026-09-19' },
  ])
  it('joins by league AND roster, ranks every conference using weekly rather than season points', () => {
    expect(report.sheets[0].rows).toHaveLength(5)
    expect(report.sheets[1].rows[1]).toEqual([1, '=formula\tname', 'League B', 'Gold', 170.25])
    expect(report.sheets[1].rows).toHaveLength(3)
    expect(report.sheets[0].rows[1][7]).toBe(0)
    expect(report.sheets[0].rows[2][7]).toBe('')
    expect(report.sheets[0].rows[4][3]).toBe('Needs team link')
    expect(report.sheets[0].rows[4][7]).toBe('')
    expect(report.sheets[2].rows[1]).toEqual(['Black', 'League A', 2, 1, 1])
  })
  it('makes clipboard text safe for spreadsheet cells', () => {
    const text = reportTsv(report)
    expect(text).toContain("'=formula name")
    expect(text).not.toContain('=formula\tname')
    expect(text).toContain('not historical standings')
  })
})
