import { describe, expect, it } from 'vitest'

import {
  buildCheckPlayers,
  lineupAlerts,
  rostersOwnedBy,
  severityOf,
  slotsOnRoster,
  type CheckLeague,
  type CheckSlot,
} from '@/lib/sleeper-check/aggregate'
import { normalizeSleeperUsername } from '@/lib/sleeper-check/username'

/*
 * The public Sleeper check, as data. Sunday 12:10 ET: Kincaid is Out and starts in two lineup
 * leagues; he also starts in a best-ball league, which picks its own lineup and so must never make
 * him urgent there.
 */
const LEAGUES: CheckLeague[] = [
  { leagueId: 'L1', name: 'KBFL', bestBall: false },
  { leagueId: 'L2', name: 'Work League', bestBall: false },
  { leagueId: 'BB', name: 'Underdog-ish', bestBall: true },
]
const slots = (entries: Array<[string, CheckSlot]>) => new Map(entries)

describe('slotsOnRoster / rostersOwnedBy', () => {
  it('reads starters, IR and taxi, and never counts an empty "0" starting slot as a player', () => {
    const s = slotsOnRoster({ players: ['a', 'b', 'c', 'd'], starters: ['a', '0'], reserve: ['c'], taxi: ['d'] })
    expect(Object.fromEntries(s)).toEqual({ a: 'starter', b: 'bench', c: 'ir', d: 'taxi' })
  })

  it('finds rosters the user owns OR co-owns, and no one else\'s', () => {
    const rosters = [{ owner_id: 'u1' }, { owner_id: 'u2', co_owners: ['u1'] }, { owner_id: 'u3' }]
    expect(rostersOwnedBy(rosters, 'u1')).toHaveLength(2)
  })
})

describe('buildCheckPlayers', () => {
  const identities = new Map([
    ['kincaid', { name: 'Dalton Kincaid', position: 'TE', team: 'BUF', imageUrl: null }],
    ['kraft', { name: 'Tucker Kraft', position: 'TE', team: 'GB', imageUrl: null }],
  ])
  const injuries = new Map([['kincaid', 'Out']])

  const players = buildCheckPlayers({
    leagues: LEAGUES,
    slotsByLeague: new Map([
      ['L1', slots([['kincaid', 'starter'], ['kraft', 'bench']])],
      ['L2', slots([['kincaid', 'starter']])],
      ['BB', slots([['kincaid', 'starter'], ['BUF', 'starter']])],
    ]),
    identities,
    injuries,
  })

  it('one row per player, with every league he is in and where he sits', () => {
    const k = players.find((p) => p.sleeperId === 'kincaid')!
    expect(k.leagues).toEqual([
      { leagueId: 'L1', slot: 'starter' },
      { leagueId: 'L2', slot: 'starter' },
      { leagueId: 'BB', slot: 'starter' },
    ])
    expect(k).toMatchObject({ starting: 3, startingSetLineup: 2, severity: 'out', injuryStatus: 'Out' })
    // Most-rostered first.
    expect(players[0]!.sleeperId).toBe('kincaid')
  })

  it('spells a position one way, whichever vendor row named him', () => {
    const p = buildCheckPlayers({
      leagues: LEAGUES,
      slotsByLeague: new Map([['L1', slots([['qb', 'starter']])]]),
      identities: new Map([['qb', { name: 'Jayden Daniels', position: 'Quarterback', team: 'WAS', imageUrl: null }]]),
      injuries: new Map(),
    })
    expect(p[0]!.position).toBe('QB')
  })

  it('names a team defense Sleeper keys by club code', () => {
    expect(players.find((p) => p.sleeperId === 'BUF')).toMatchObject({ name: 'BUF D/ST', position: 'DEF' })
  })

  it('alerts on a hurt player in a lineup the manager sets — and never for best ball alone', () => {
    expect(lineupAlerts(players).map((p) => p.sleeperId)).toEqual(['kincaid'])
    const onlyBestBall = buildCheckPlayers({
      leagues: LEAGUES,
      slotsByLeague: new Map([['BB', slots([['kincaid', 'starter']])]]),
      identities,
      injuries,
    })
    expect(lineupAlerts(onlyBestBall)).toEqual([])
  })

  it('ranks ruled-out ahead of at-risk, then by how many lineups it hits', () => {
    const many = buildCheckPlayers({
      leagues: LEAGUES,
      slotsByLeague: new Map([
        ['L1', slots([['q', 'starter'], ['o', 'starter']])],
        ['L2', slots([['q', 'starter']])],
      ]),
      identities: new Map(),
      injuries: new Map([
        ['q', 'Questionable'],
        ['o', 'Out'],
      ]),
    })
    expect(lineupAlerts(many).map((p) => p.sleeperId)).toEqual(['o', 'q'])
  })
})

describe('severityOf', () => {
  it('reads the shared injury vocabulary: absence, risk, or nothing', () => {
    expect(severityOf('Out')).toBe('out')
    expect(severityOf('IR')).toBe('out')
    expect(severityOf('Questionable')).toBe('risk')
    expect(severityOf('Active')).toBeNull()
    expect(severityOf(null)).toBeNull()
  })
})

describe('normalizeSleeperUsername', () => {
  it('strips @ and whitespace, keeps case for the lookup to decide', () => {
    expect(normalizeSleeperUsername('  @TheCiege24 ')).toBe('TheCiege24')
  })

  it('refuses what can never be a username and could reach a provider path', () => {
    for (const bad of ['', '   ', 'a b', '../user', 'x?y=1', 'a#b', 'a%2F', 'x'.repeat(41), 42, null]) {
      expect(normalizeSleeperUsername(bad)).toBeNull()
    }
  })
})
