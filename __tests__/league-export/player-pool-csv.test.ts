import { describe, expect, it } from 'vitest'
import {
  buildPlayerPoolCsvRows,
  csvCell,
  NOT_IN_POOL,
  playerPoolCsvFilename,
  rosterSpots,
  toPlayerPoolCsv,
  type CsvPoolPlayer,
} from '@/lib/league-export/playerPoolCsv'

const key = (name: string, pos: string) => `${name.toLowerCase()}|${pos.toLowerCase()}`
const player = (over: Partial<CsvPoolPlayer> & { afId: string; name: string }): CsvPoolPlayer => ({
  sleeperId: null,
  providerId: null,
  position: 'WR',
  team: 'CIN',
  injury: null,
  ...over,
})

describe('rosterSpots', () => {
  it('reads native lineup sections, and the most specific spot wins', () => {
    const spots = rosterSpots({
      players: ['a', 'b', 'c', 'd', 'e'],
      starters: ['a'],
      lineup_sections: { starters: [{ id: 'a' }], ir: [{ id: 'b' }], taxi: [{ id: 'c' }], devy: [{ id: 'd' }], bench: [{ id: 'e' }] },
    })
    expect(Object.fromEntries(spots)).toEqual({ a: 'Starter', b: 'IR', c: 'Taxi', d: 'Devy', e: 'Bench' })
  })
  it('reads an imported roster: starters, reserve and taxi arrays, Sleeper "0" empty slots dropped', () => {
    const spots = rosterSpots({ players: ['1', '2', '3', '4'], starters: ['1', '0'], reserve: ['2'], taxi: ['3'] })
    expect(Object.fromEntries(spots)).toEqual({ 1: 'Starter', 2: 'IR', 3: 'Taxi', 4: 'Bench' })
  })
})

describe('buildPlayerPoolCsvRows', () => {
  const pool = [
    player({ afId: 'af-chase', sleeperId: '7564', name: "Ja'Marr Chase" }),
    player({ afId: 'af-free', name: 'Free Agent Guy', position: 'RB' }),
    player({ afId: 'af-late', name: 'Late Pick', position: 'TE' }),
    player({ afId: 'af-noadp', name: 'Aaron Nobody', position: 'QB' }),
    player({ afId: 'af-prov', providerId: 'ff-99', name: 'Provider Matched' }),
  ]
  const rows = buildPlayerPoolCsvRows({
    pool,
    rosters: [
      // An imported Sleeper roster: Sleeper id, provider id, and a devy prospect no player table has.
      { rosterId: 'r1', teamName: 'Peach Pit', managerName: 'TheCiege24', playerData: { players: ['7564', 'ff-99', 'cfb-123'], starters: ['7564'], taxi: ['cfb-123'] } },
    ],
    adpByKey: new Map([
      [key("Ja'Marr Chase", 'WR'), 1.4],
      [key('Free Agent Guy', 'RB'), 40.25],
      [key('Late Pick', 'TE'), 120],
    ]),
    playerKey: key,
  })

  it('matches rostered players on the Sleeper id and the provider id', () => {
    const chase = rows.find((r) => r.afId === 'af-chase')!
    expect(chase).toMatchObject({ status: 'Starter', fantasyTeam: 'Peach Pit', manager: 'TheCiege24', adp: '1.4', sleeperId: '7564' })
    expect(rows.find((r) => r.afId === 'af-prov')).toMatchObject({ status: 'Bench', fantasyTeam: 'Peach Pit' })
  })

  it('keeps a rostered player the pool does not carry, on its team', () => {
    expect(rows.find((r) => r.providerId === 'cfb-123')).toMatchObject({ name: NOT_IN_POOL, status: 'Taxi', fantasyTeam: 'Peach Pit' })
  })

  it('lists rostered players first (by team, then spot), then free agents by ADP, no-ADP last', () => {
    expect(rows.map((r) => `${r.status}: ${r.name}`)).toEqual([
      'Bench: Provider Matched',
      "Starter: Ja'Marr Chase",
      `Taxi: ${NOT_IN_POOL}`,
      'Free agent: Free Agent Guy',
      'Free agent: Late Pick',
      'Free agent: Aaron Nobody',
    ])
  })
})

describe('CSV text', () => {
  it('quotes commas and quotes, and defuses a cell a spreadsheet would run as a formula', () => {
    expect(csvCell('Smith, Jr.')).toBe('"Smith, Jr."')
    expect(csvCell('The "Real" Team')).toBe('"The ""Real"" Team"')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('Plain')).toBe('Plain')
  })
  it('starts with a BOM and the header row, and uses CRLF', () => {
    const csv = toPlayerPoolCsv([])
    expect(csv.startsWith('﻿Player,Position,Team,Roster status,Fantasy team,Manager,ADP,Injury,AllFantasy ID,Sleeper ID,Provider ID\r\n')).toBe(true)
  })
  it('names the file after the league and season', () => {
    expect(playerPoolCsvFilename('Peach Bowl (C2C)', 2026)).toBe('peach-bowl-c2c-players-2026.csv')
    expect(playerPoolCsvFilename('!!!', null)).toBe('league-players.csv')
  })
})
