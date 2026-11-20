/**
 * The Best Ball tab for an imported league (lib/bestball/importedBestBallTab.ts): built from the weekly
 * team scores we store. It was empty for all 141 imported best ball leagues in production.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildImportedBestBallTab, importedBestBallNote } from '@/lib/bestball/importedBestBallTab'
import { settingWords } from '@/app/league/[leagueId]/tabs/BestBallTab'

const teams = [
  { externalId: '1', teamName: 'BS & The Duch', ownerName: 'bs' },
  { externalId: '2', teamName: null, ownerName: 'Bogoljub' },
  { externalId: '3', teamName: '  ', ownerName: null },
  { externalId: '4', teamName: 'Ghost Team', ownerName: null },
]
const row = (weekOrPeriod: number, teamA: string, teamB: string, scoreA: number, scoreB: number) => ({ weekOrPeriod, teamA, teamB, scoreA, scoreB })
const rows = [
  row(1, '1', '2', 120.5, 99.25), row(1, '3', '4', 88, 88),
  row(2, '1', '3', 101, 130.4), row(2, '2', '4', 110, 90),
  // The provider lists the whole schedule up front at 0-0.
  row(3, '1', '4', 0, 0), row(3, '2', '3', 0, 0),
]

describe('buildImportedBestBallTab', () => {
  it('lists only weeks that have a score, and opens on the latest', () => {
    const tab = buildImportedBestBallTab(rows, teams, null)
    expect(tab.weeksAvailable).toEqual([1, 2])
    expect(tab.selectedWeek).toBe(2)
    expect(buildImportedBestBallTab(rows, teams, 1).selectedWeek).toBe(1)
    // A week that is not there (unplayed, or nonsense) falls back to the latest played one.
    expect(buildImportedBestBallTab(rows, teams, 3).selectedWeek).toBe(2)
  })

  it('one card per team for the week: its score and result, highest first, and no invented lineup', () => {
    const tab = buildImportedBestBallTab(rows, teams, 1)
    expect(tab.lineups.map((l) => [l.teamName, l.totalPoints, l.winLoss])).toEqual([
      ['BS & The Duch', 120.5, 'W'],
      ['Bogoljub', 99.25, 'L'],
      ['Ghost Team', 88, 'T'],
      ['Team', 88, 'T'],
    ])
    for (const l of tab.lineups) expect([l.starters, l.bench]).toEqual([[], []])
  })

  it('standings and history come from the played weeks only', () => {
    const tab = buildImportedBestBallTab(rows, teams, null)
    expect(tab.standings.map((s) => [s.rank, s.teamName, s.wins, s.losses, s.ties, s.pointsFor, s.pointsAgainst])).toEqual([
      [1, 'BS & The Duch', 1, 1, 0, 221.5, 229.65],
      [2, 'Team', 1, 0, 1, 218.4, 189],
      [3, 'Bogoljub', 1, 1, 0, 209.25, 210.5],
      [4, 'Ghost Team', 0, 1, 1, 178, 198],
    ])
    expect(tab.history).toHaveLength(8)
    expect(tab.history.every((h) => h.week <= 2)).toBe(true)
  })

  it('a bye is a score with no result; nothing stored is an empty tab on week 1', () => {
    const bye = buildImportedBestBallTab([row(1, '1', '', 95, 0)], teams, null)
    expect(bye.lineups).toEqual([{ rosterId: '1', teamName: 'BS & The Duch', totalPoints: 95, winLoss: null, starters: [], bench: [] }])
    expect(bye.standings[0]).toMatchObject({ wins: 0, losses: 0, ties: 0, pointsFor: 95 })
    expect(buildImportedBestBallTab([], teams, null)).toEqual({ selectedWeek: 1, weeksAvailable: [], lineups: [], standings: [], history: [] })
  })
})

describe('importedBestBallNote', () => {
  it('names the platform, or says "your league’s platform"', () => {
    expect(importedBestBallNote('sleeper')).toBe('Sleeper picks this league’s best ball lineups. AllFantasy shows each team’s score for the week; the players that counted are on Sleeper.')
    expect(importedBestBallNote(null)).toContain('your league’s platform picks')
  })
})

describe('the tab and the handler use it only for an imported league with nothing in the legacy tables', () => {
  const handler = readFileSync(join(process.cwd(), 'app/api/leagues/[leagueId]/bestball/handler.ts'), 'utf8')
  const tab = readFileSync(join(process.cwd(), 'app/league/[leagueId]/tabs/BestBallTab.tsx'), 'utf8')
  it('the handler gates on no legacy weeks and a non-native platform', () => {
    expect(handler).toMatch(/^\s*if \(weeksAvailable\.length === 0 && resolveWriteAuthority\(league\.platform\) !== 'NATIVE'\) \{$/m)
    expect(handler).toMatch(/^\s*source: 'imported',$/m)
  })
  it('the tab asks for no week first, so the server opens it on the latest scored week', () => {
    expect(tab).toMatch(/^\s*const \[week, setWeek\] = useState<number \| null>\(null\)$/m)
    expect(tab).toContain("bestball${week == null ? '' : `?week=${week}`}")
  })

  it('the tab shows the note and does not print "0 counted" on an imported card', () => {
    expect(tab).toContain('data-testid="bestball-imported-note"')
    expect(tab).toMatch(/data\.source === 'imported' \? null : <div className="text-\[11px\] text-white\/40">\{lineup\.starters\.length\} counted<\/div>/)
  })
})

describe('settingWords', () => {
  it('prints a stored setting as words', () => {
    expect(settingWords('season_long')).toBe('Season long')
    expect(settingWords('snake')).toBe('Snake')
    expect(settingWords('cumulative')).toBe('Cumulative')
    expect(settingWords(null)).toBe('—')
  })
})
