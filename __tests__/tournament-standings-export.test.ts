// @vitest-environment node
/**
 * Guards the paste-ready standings block.
 *
 * 🛑 THE LAYOUT IS NOT OURS TO CHOOSE. The commissioner's workbook already has
 * this shape — RANK, Team Name, W/L, Total Pts, Conference, Conference Pts, in
 * per-league blocks with the rank restarting inside each and the league's
 * combined points printed once. An export that is "close" pastes into the wrong
 * columns, which is worse than no export: it looks like it worked.
 */
import { describe, it, expect } from 'vitest'
import {
  buildConferenceStandingsExport,
  buildTopScorers,
  formatPoints,
  formatRecord,
  type ExportLeagueBlock,
} from '@/lib/tournament/standingsExport'

const BEAST: ExportLeagueBlock = {
  leagueName: 'BEAST',
  rows: [
    { rank: 1, teamName: 'TyT1', wins: 7, losses: 2, ties: 0, pointsFor: 1_204.56 },
    { rank: 2, teamName: 'emmae', wins: 6, losses: 3, ties: 0, pointsFor: 1_180.02 },
  ],
}

const GOAT: ExportLeagueBlock = {
  leagueName: 'GOAT',
  rows: [{ rank: 1, teamName: 'RICO3', wins: 8, losses: 1, ties: 0, pointsFor: 1_311.1 }],
}

describe('the paste-ready conference block', () => {
  it('emits the sheet’s own six columns, tab separated', () => {
    const { tsv } = buildConferenceStandingsExport([BEAST])
    expect(tsv.split('\n')[0]).toBe('RANK\tTeam Name\tW/L\tTotal Pts\tConference\tConference Pts')
  })

  /**
   * ⚠ TAB SEPARATED, NOT COMMA. TSV pasted into Excel or Sheets fills cells;
   * CSV lands as one column of text and needs Text-to-Columns, which is a step
   * back towards the manual work this removes.
   */
  it('separates with tabs so a paste lands in cells', () => {
    const { tsv } = buildConferenceStandingsExport([BEAST])
    expect(tsv).toContain('1\tTyT1\t7-2\t1204.56\tBEAST\t')
    expect(tsv).not.toContain(',')
  })

  /**
   * ⚠ ONCE PER LEAGUE, ON ITS FIRST ROW. Repeating it down the column produces a
   * column of identical numbers that sums wrongly if anyone ever totals it.
   */
  it('prints the league’s combined points once, on the first row only', () => {
    const { tsv } = buildConferenceStandingsExport([BEAST])
    const rows = tsv.split('\n').slice(1)
    expect(rows[0].split('\t')[5]).toBe('2384.58')
    expect(rows[1].split('\t')[5]).toBe('')
  })

  it('separates league blocks with a blank row, as the sheet is laid out', () => {
    const { tsv } = buildConferenceStandingsExport([BEAST, GOAT])
    const lines = tsv.split('\n')
    expect(lines[3]).toBe('')
    expect(lines[4].split('\t')[4]).toBe('GOAT')
    /* Rank restarts inside each block — it is a league rank, not a running row number. */
    expect(lines[4].split('\t')[0]).toBe('1')
  })

  /**
   * 🛑 MISSING IS NOT ZERO, and this is the column where the difference ends
   * someone's season. A manager whose team row did not match the import is not a
   * manager who scored nothing.
   */
  it('leaves an unmatched row blank rather than printing 0-0 and 0.00', () => {
    const { tsv, unmatchedCount } = buildConferenceStandingsExport([
      {
        leagueName: 'GRIZZ',
        rows: [
          { rank: 1, teamName: 'CaptainCanucks', wins: 0, losses: 0, ties: 0, pointsFor: 0, unmatched: true },
          { rank: 2, teamName: 'deWinterIsHere', wins: 5, losses: 4, ties: 0, pointsFor: 1_000 },
        ],
      },
    ])
    const rows = tsv.split('\n').slice(1)
    expect(rows[0].split('\t')[2]).toBe('')
    expect(rows[0].split('\t')[3]).toBe('')
    expect(unmatchedCount).toBe(1)
  })

  /** ⚠ An unmatched row must not drag the league total down either. */
  it('excludes an unmatched row from the league’s combined points', () => {
    const { tsv } = buildConferenceStandingsExport([
      {
        leagueName: 'GRIZZ',
        rows: [
          { rank: 1, teamName: 'x', wins: 0, losses: 0, ties: 0, pointsFor: 0, unmatched: true },
          { rank: 2, teamName: 'y', wins: 5, losses: 4, ties: 0, pointsFor: 1_000 },
        ],
      },
    ])
    expect(tsv.split('\n')[1].split('\t')[5]).toBe('1000.00')
  })

  /**
   * ⚠ POINTS-FOR IS THE FIRST TIEBREAKER AFTER W/L, so the hundredths decide who
   * advances. Whole-point rounding manufactures ties the real numbers do not
   * have.
   */
  it('keeps two decimals, because the hundredths break ties', () => {
    expect(formatPoints(1_204.5)).toBe('1204.50')
    expect(formatPoints(1_204.567)).toBe('1204.57')
  })

  it('writes ties into the record only when there are any', () => {
    expect(formatRecord(6, 3, 0)).toBe('6-3')
    expect(formatRecord(6, 2, 1)).toBe('6-2-1')
  })
})

describe('top scorers', () => {
  it('ranks across every league in the conference, not within one', () => {
    const out = buildTopScorers([BEAST, GOAT])
    expect(out.map((s) => s.teamName)).toEqual(['RICO3', 'TyT1', 'emmae'])
    expect(out[0]).toMatchObject({ rank: 1, leagueName: 'GOAT' })
  })

  /** ⚠ An unmatched row has no score to rank — it must not appear as a zero. */
  it('omits unmatched rows rather than ranking them last on a zero', () => {
    const out = buildTopScorers([
      { leagueName: 'X', rows: [{ rank: 1, teamName: 'ghost', wins: 0, losses: 0, ties: 0, pointsFor: 0, unmatched: true }] },
    ])
    expect(out).toEqual([])
  })
})
