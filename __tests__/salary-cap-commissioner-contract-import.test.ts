/**
 * A commissioner's contract sheet for an imported salary cap league
 * (lib/salary-cap/commissionerContractImport.ts): read as written, matched exactly, never guessed.
 */
import { describe, expect, it } from 'vitest'
import { contractTotalsByTeam, matchContractSheet, nameKey, parseContractSheet, yearSignedFor } from '@/lib/salary-cap/commissionerContractImport'

const teams = [
  { rosterId: 'r1', names: ['Gridiron Kings', 'alex'] },
  { rosterId: 'r2', names: ['Cap Casualties', 'sam'] },
  { rosterId: 'r3', names: ['Third Team', 'alex'] },
]
const players = [
  { rosterId: 'r1', playerId: 'p1', name: 'Patrick Mahomes II', position: 'QB' },
  { rosterId: 'r1', playerId: 'p2', name: "Ja'Marr Chase", position: 'WR' },
  { rosterId: 'r2', playerId: 'p3', name: 'Amon-Ra St. Brown', position: 'WR' },
  { rosterId: 'r2', playerId: 'p4', name: 'Josh Allen', position: 'QB' },
  { rosterId: 'r2', playerId: 'p5', name: 'Josh Allen', position: 'LB' },
]

describe('parseContractSheet', () => {
  it('reads comma- and tab-separated rows, skips a header, keeps commas inside a quoted amount, and defaults the contract year to 1', () => {
    const { rows, problems } = parseContractSheet('Team,Player,Salary,Years,Year\nGridiron Kings,Patrick Mahomes,"$45,000,000",4,2\nCap Casualties\tAmon-Ra St. Brown\t18.4\t3\n\n')
    expect(problems).toEqual([])
    expect(rows.map((r) => [r.line, r.team, r.player, r.salary, r.yearsTotal, r.contractYear])).toEqual([
      [2, 'Gridiron Kings', 'Patrick Mahomes', 45000000, 4, 2],
      [3, 'Cap Casualties', 'Amon-Ra St. Brown', 18, 3, 1],
    ])
  })

  it('reports each unreadable row with its line and why, and reads the rest', () => {
    const { rows, problems } = parseContractSheet(['A,B,10,2', 'only,three,cols', 'A,B,lots,2', 'A,B,10,0', 'A,B,10,11', 'A,B,10,2,3', ',B,10,2', 'A,C,5,1,1'].join('\n'))
    expect(rows.map((r) => r.line)).toEqual([1, 8])
    expect(problems.map((p) => [p.line, p.reason])).toEqual([
      [2, 'Needs four columns: team, player, salary, years'],
      [3, 'Salary "lots" is not a number'],
      [4, 'Years "0" must be a whole number from 1 to 10'],
      [5, 'Years "11" must be a whole number from 1 to 10'],
      [6, 'Contract year "3" must be between 1 and the 2 years on the contract'],
      [7, 'Team and player cannot be empty'],
    ])
  })

  it('nothing pasted reads as nothing', () => {
    expect(parseContractSheet('')).toEqual({ rows: [], problems: [] })
    expect(parseContractSheet('Team,Player,Salary,Years\n')).toEqual({ rows: [], problems: [] })
  })
})

describe('nameKey', () => {
  it('ignores case, punctuation, accents and a generational suffix', () => {
    expect(nameKey('Patrick Mahomes II')).toBe(nameKey('patrick mahomes'))
    expect(nameKey("Ja'Marr Chase")).toBe(nameKey('JaMarr Chase'))
    expect(nameKey('Amon-Ra St. Brown')).toBe(nameKey('amon ra st brown'))
    expect(nameKey('José Ramírez Jr.')).toBe('jose ramirez')
  })
})

describe('matchContractSheet', () => {
  const sheet = (text: string) => parseContractSheet(text).rows

  it('attaches a row to the one team and the one player on it', () => {
    const { matched, problems } = matchContractSheet(sheet('gridiron kings,patrick mahomes,45,4,2\nCap Casualties,Amon-Ra St Brown,18,3'), teams, players)
    expect(problems).toEqual([])
    expect(matched).toEqual([
      { line: 1, rosterId: 'r1', teamName: 'gridiron kings', playerId: 'p1', playerName: 'Patrick Mahomes II', position: 'QB', salary: 45, yearsTotal: 4, contractYear: 2 },
      { line: 2, rosterId: 'r2', teamName: 'Cap Casualties', playerId: 'p3', playerName: 'Amon-Ra St. Brown', position: 'WR', salary: 18, yearsTotal: 3, contractYear: 1 },
    ])
  })

  it('a manager name works when it names one team, and is refused when it names two', () => {
    expect(matchContractSheet(sheet('sam,Amon-Ra St. Brown,18,3'), teams, players).matched).toHaveLength(1)
    expect(matchContractSheet(sheet('alex,Patrick Mahomes,45,4'), teams, players).problems[0].reason).toBe('More than one team matches "alex"; use the team name instead of the manager name')
  })

  it('never guesses: unknown team, player on another roster, two players of that name, and a repeat are all reported', () => {
    const { matched, problems } = matchContractSheet(
      sheet(['Nobody FC,Patrick Mahomes,45,4', 'Cap Casualties,Patrick Mahomes,45,4', 'Cap Casualties,Josh Allen,30,2', "Gridiron Kings,Ja'Marr Chase,25,3", 'Gridiron Kings,JaMarr Chase,26,3'].join('\n')),
      teams,
      players,
    )
    expect(matched.map((m) => m.playerId)).toEqual(['p2'])
    expect(problems.map((p) => [p.line, p.reason])).toEqual([
      [1, 'No team in this league is called "Nobody FC"'],
      [2, "Patrick Mahomes is not on Cap Casualties's roster"],
      [3, 'Two players on Cap Casualties are called Josh Allen'],
      [5, 'JaMarr Chase is already listed on line 4'],
    ])
  })
})

describe('the season a contract was signed, and the preview totals', () => {
  it('year 1 of a deal was signed this season; year 3 two seasons ago', () => {
    expect(yearSignedFor(2026, 1)).toBe(2026)
    expect(yearSignedFor(2026, 3)).toBe(2024)
  })
  it('totals each team\'s contracts and this season\'s cost, biggest first', () => {
    const { matched } = matchContractSheet(parseContractSheet("Gridiron Kings,Patrick Mahomes,45,4\nGridiron Kings,Ja'Marr Chase,25,3\nCap Casualties,Amon-Ra St. Brown,18,3").rows, teams, players)
    expect(contractTotalsByTeam(matched)).toEqual([
      { rosterId: 'r1', teamName: 'Gridiron Kings', contracts: 2, capHit: 70 },
      { rosterId: 'r2', teamName: 'Cap Casualties', contracts: 1, capHit: 18 },
    ])
  })
})
