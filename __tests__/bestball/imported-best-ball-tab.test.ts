/**
 * The Best Ball tab for an imported league (lib/bestball/importedBestBallTab.ts): built from the weekly
 * team scores we store. It was empty for all 141 imported best ball leagues in production.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildImportedBestBallTab, importedBestBallNote, teamWeeksFromMatchupFacts } from '@/lib/bestball/importedBestBallTab'
import { settingWords } from '@/app/league/[leagueId]/tabs/BestBallTab'

const teams = [
  { externalId: '1', teamName: 'BS & The Duch', ownerName: 'bs' },
  { externalId: '2', teamName: null, ownerName: 'Bogoljub' },
  { externalId: '3', teamName: '  ', ownerName: null },
  { externalId: '4', teamName: 'Ghost Team', ownerName: null },
]
// One row per team per game, as the regular sync stores them (`WeeklyMatchup`).
const game = (week: number, matchupId: number | null, a: [string, number], b?: [string, number]) => [
  { week, rosterId: a[0], pointsFor: a[1], matchupId },
  ...(b ? [{ week, rosterId: b[0], pointsFor: b[1], matchupId }] : []),
]
const rows = [
  ...game(1, 1, ['1', 120.5], ['2', 99.25]), ...game(1, 2, ['3', 88], ['4', 88]),
  ...game(2, 1, ['1', 101], ['3', 130.4]), ...game(2, 2, ['2', 110], ['4', 90]),
  // The provider lists the whole schedule up front at 0.
  ...game(3, 1, ['1', 0], ['4', 0]), ...game(3, 2, ['2', 0], ['3', 0]),
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

  it('a team with no opponent has a score and no result; nothing stored is an empty tab on week 1', () => {
    const bye = buildImportedBestBallTab(game(1, null, ['1', 95]), teams, null)
    expect(bye.lineups).toEqual([{ rosterId: '1', teamName: 'BS & The Duch', totalPoints: 95, winLoss: null, starters: [], bench: [] }])
    expect(bye.standings[0]).toMatchObject({ wins: 0, losses: 0, ties: 0, pointsFor: 95 })
    expect(buildImportedBestBallTab([], teams, null)).toEqual({ selectedWeek: 1, weeksAvailable: [], lineups: [], standings: [], history: [] })
  })

  it('a league that plays several games a week: one card per team with the points summed, every game in the standings', () => {
    const multi = [
      { week: 1, rosterId: '1', pointsFor: 50, matchupId: 1, game: 1 }, { week: 1, rosterId: '2', pointsFor: 40, matchupId: 1, game: 1 },
      { week: 1, rosterId: '1', pointsFor: 30, matchupId: 1, game: 2 }, { week: 1, rosterId: '2', pointsFor: 45, matchupId: 1, game: 2 },
    ]
    const tab = buildImportedBestBallTab(multi, teams, null)
    expect(tab.lineups.map((l) => [l.teamName, l.totalPoints, l.winLoss])).toEqual([['Bogoljub', 85, null], ['BS & The Duch', 80, null]])
    expect(tab.standings.map((s) => [s.teamName, s.wins, s.losses])).toEqual([['Bogoljub', 1, 1], ['BS & The Duch', 1, 1]])
    expect(tab.history).toEqual([{ rosterId: '1', week: 1, totalPoints: 80 }, { rosterId: '2', week: 1, totalPoints: 85 }])
  })
})

describe('teamWeeksFromMatchupFacts: the older store reads the same way', () => {
  it('a stored game becomes two team rows that pair up; a bye becomes one with no opponent', () => {
    const facts = [
      { weekOrPeriod: 1, teamA: '1', teamB: '2', scoreA: 120.5, scoreB: 99.25 },
      { weekOrPeriod: 1, teamA: '3', teamB: '', scoreA: 95, scoreB: 0 },
    ]
    const tab = buildImportedBestBallTab(teamWeeksFromMatchupFacts(facts), teams, null)
    expect(tab.lineups.map((l) => [l.teamName, l.totalPoints, l.winLoss])).toEqual([['BS & The Duch', 120.5, 'W'], ['Bogoljub', 99.25, 'L'], ['Team', 95, null]])
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
    expect(handler).toMatch(/^\s*if \(weeksAvailable\.length === 0 && resolveWriteAuthority\(league\) !== 'NATIVE'\) \{$/m)
    expect(handler).toMatch(/^\s*source: 'imported',$/m)
    // The store the regular sync keeps current is read first; the slower one only when it is empty.
    expect(handler.indexOf('prisma.weeklyMatchup.findMany')).toBeGreaterThan(0)
    expect(handler.indexOf('prisma.weeklyMatchup.findMany')).toBeLessThan(handler.indexOf('prisma.matchupFact.findMany'))
  })
  it('the tab asks for no week first, so the server opens it on the latest scored week', () => {
    expect(tab).toMatch(/^\s*const \[week, setWeek\] = useState<number \| null>\(null\)$/m)
    expect(tab).toContain("bestball${week == null ? '' : `?week=${week}`}")
  })

  it('the tab shows the note and does not print "0 counted" on an imported card', () => {
    expect(tab).toContain('data-testid="bestball-imported-note"')
    // The card's own `imported` flag (LineupCard), not the colour classes, which moved to tokens on 2026-11-23.
    expect(tab).toContain("const imported = data.source === 'imported'")
    expect(tab).toMatch(/imported \? null : <div className="[^"]*">\{lineup\.starters\.length\} counted<\/div>/)
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

describe('the Team tab in a best ball league', () => {
  const lineup = readFileSync(join(process.cwd(), 'components/league/native/screens/NativeLineupScreen.tsx'), 'utf8')
  it('says the lineup is automatic, and offers neither Optimize nor Propose trade', () => {
    expect(lineup).toContain('data-testid="lineup-best-ball-note"')
    // Sleeper pass 2 (2026-11-28): no Team tab offers Propose trade any more; trades start from the player card.
    expect(lineup).not.toContain('>Propose trade</button>')
    expect(lineup).toMatch(/data-variant="primary" hidden=\{Boolean\(league\.bestBallMode\)\}/)
  })
})
