/**
 * Bridging imported rosters into the table the cap engine actually reads.
 *
 * 🛑 `assignDraftSalary`, `processFranchiseTag` and the league cap overview key on
 * `RedraftRosterPlayer`. A league imported from Sleeper gets `RedraftRoster` rows but its
 * players land in `Roster.playerData` as bare id strings. KBFL, measured 2026-08-30: 32
 * RedraftRoster rows, 1,055 players in playerData, ZERO RedraftRosterPlayer rows. A cap could
 * be enabled and have no player to price.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFind: vi.fn(),
  rosterMany: vi.fn(),
  redraftMany: vi.fn(),
  sportsMany: vi.fn(),
  rrpMany: vi.fn(),
  rrpCreate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFind },
    roster: { findMany: mocks.rosterMany },
    redraftRoster: { findMany: mocks.redraftMany },
    sportsPlayer: { findMany: mocks.sportsMany },
    redraftRosterPlayer: { findMany: mocks.rrpMany, create: mocks.rrpCreate },
  },
}))

import { bridgeRosterPlayersForLeague, normalizeRosterPosition, isDefensivePosition } from '@/lib/idp/bridgeRosterPlayers'

const roster = (id: string, platformUserId: string, players: string[], extra: Record<string, unknown> = {}) => ({
  id, platformUserId, playerData: { players, import: {}, ...extra },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leagueFind.mockResolvedValue({ sport: 'NFL' })
  mocks.rrpMany.mockResolvedValue([])
  mocks.rrpCreate.mockResolvedValue({})
})

describe('position normalisation', () => {
  it('folds long vendor spellings to the abbreviations IDP predicates use', () => {
    expect(normalizeRosterPosition('Linebacker')).toBe('LB')
    expect(normalizeRosterPosition('Defensive End')).toBe('DE')
    expect(normalizeRosterPosition('Wide Receiver')).toBe('WR')
    expect(normalizeRosterPosition('LB')).toBe('LB')
    expect(normalizeRosterPosition('  ')).toBeNull()
  })

  it('recognises defenders only by abbreviation, which is why folding matters', () => {
    expect(isDefensivePosition('LB')).toBe(true)
    expect(isDefensivePosition(normalizeRosterPosition('Linebacker'))).toBe(true)
    // The unfolded spelling is invisible to every IDP predicate in the repo.
    expect(isDefensivePosition('Linebacker')).toBe(false)
  })
})

describe('the roster join', () => {
  it('matches by ownerId when it can', async () => {
    mocks.rosterMany.mockResolvedValue([roster('g1', 'own1', ['1'])])
    mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'own1', ownerName: 'A', teamName: 'T' }])
    mocks.sportsMany.mockResolvedValue([{ sleeperId: '1', sport: 'NFL', name: 'P', position: 'LB', team: 'KC' }])
    const r = await bridgeRosterPlayersForLeague('lg', { dryRun: true })
    expect(r.rostersMatched).toBe(1)
    expect(r.rostersSkipped).toEqual([])
  })

  /**
   * ⚠ THE FALLBACK IS NOT DECORATION. On KBFL, platformUserId -> ownerId matched only 30 of 32.
   * Without this, two teams silently receive no players while the run reports success.
   */
  it('falls back to team name when the id does not match', async () => {
    mocks.rosterMany.mockResolvedValue([
      roster('g1', 'MISMATCH', ['1'], { import: { teamName: 'Bandits', ownerName: 'zed' } }),
    ])
    mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'other', ownerName: 'zed', teamName: 'Bandits' }])
    mocks.sportsMany.mockResolvedValue([{ sleeperId: '1', sport: 'NFL', name: 'P', position: 'LB', team: 'KC' }])
    const r = await bridgeRosterPlayersForLeague('lg', { dryRun: true })
    expect(r.rostersMatched).toBe(1)
    expect(r.created).toBe(1)
  })

  /** 🛑 A roster it cannot match is SKIPPED and reported, never guessed at. */
  it('skips rather than guesses when nothing matches', async () => {
    mocks.rosterMany.mockResolvedValue([roster('g1', 'nope', ['1'], { import: { teamName: 'X', ownerName: 'Y' } })])
    mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'a', ownerName: 'b', teamName: 'c' }])
    mocks.sportsMany.mockResolvedValue([])
    const r = await bridgeRosterPlayersForLeague('lg', { dryRun: true })
    expect(r.rostersMatched).toBe(0)
    expect(r.rostersSkipped[0]).toMatchObject({ rosterId: 'g1', reason: 'no matching redraft roster' })
  })
})

describe('position resolution across disagreeing vendors', () => {
  /**
   * 🛑 THE REAL CASE, AND IT NEARLY COST A PLAYER. sleeperId 4976 is Daron Payne, a defensive
   * tackle. `thesportsdb` calls him "Guard"; `sleeper` says "DT". composePlayerIdentities is
   * first-wins on position, so Postgres row order decided what a fantasy roster saw — and the
   * first version of this bridge wrote him as GUARD. Filtering non-fantasy positions would then
   * have DELETED a rostered starting defender and called it cleanup.
   */
  it('prefers the rosterable position when vendors disagree, whatever the row order', async () => {
    mocks.rosterMany.mockResolvedValue([roster('g1', 'own1', ['4976'])])
    mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'own1', ownerName: 'A', teamName: 'T' }])
    for (const order of [
      [{ position: 'Guard', team: 'Washington Commanders' }, { position: 'DT', team: 'WAS' }],
      [{ position: 'DT', team: 'WAS' }, { position: 'Guard', team: 'Washington Commanders' }],
    ]) {
      vi.clearAllMocks()
      mocks.leagueFind.mockResolvedValue({ sport: 'NFL' })
      mocks.rrpMany.mockResolvedValue([])
      mocks.rosterMany.mockResolvedValue([roster('g1', 'own1', ['4976'])])
      mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'own1', ownerName: 'A', teamName: 'T' }])
      mocks.sportsMany.mockResolvedValue(order.map((o) => ({ sleeperId: '4976', sport: 'NFL', name: 'Daron Payne', ...o })))
      const r = await bridgeRosterPlayersForLeague('lg', { dryRun: false })
      expect(r.created).toBe(1)
      expect(r.filtered).toEqual({})
      expect(mocks.rrpCreate.mock.calls[0][0].data.position).toBe('DT')
      expect(r.defendersCreated).toBe(1)
    }
  })

  /** Filtered only when NO vendor offers a rosterable position — and counted, never silent. */
  it('filters a genuinely non-fantasy player and reports it', async () => {
    mocks.rosterMany.mockResolvedValue([roster('g1', 'own1', ['999'])])
    mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'own1', ownerName: 'A', teamName: 'T' }])
    mocks.sportsMany.mockResolvedValue([{ sleeperId: '999', sport: 'NFL', name: 'Lineman', position: 'Guard', team: 'WAS' }])
    const r = await bridgeRosterPlayersForLeague('lg', { dryRun: true })
    expect(r.created).toBe(0)
    expect(r.filtered).toEqual({ GUARD: 1 })
  })
})

describe('writing', () => {
  it('is idempotent — an existing row is counted, not duplicated', async () => {
    mocks.rosterMany.mockResolvedValue([roster('g1', 'own1', ['1'])])
    mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'own1', ownerName: 'A', teamName: 'T' }])
    mocks.sportsMany.mockResolvedValue([{ sleeperId: '1', sport: 'NFL', name: 'P', position: 'LB', team: 'KC' }])
    mocks.rrpMany.mockResolvedValue([{ rosterId: 'r1', playerId: '1' }])
    const r = await bridgeRosterPlayersForLeague('lg', { dryRun: false })
    expect(r.alreadyPresent).toBe(1)
    expect(r.created).toBe(0)
    expect(mocks.rrpCreate).not.toHaveBeenCalled()
  })

  it('marks rows imported rather than drafted, and infers the slot', async () => {
    mocks.rosterMany.mockResolvedValue([roster('g1', 'own1', ['1', '2'], { starters: ['1'] })])
    mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'own1', ownerName: 'A', teamName: 'T' }])
    mocks.sportsMany.mockResolvedValue([
      { sleeperId: '1', sport: 'NFL', name: 'S', position: 'LB', team: 'KC' },
      { sleeperId: '2', sport: 'NFL', name: 'B', position: 'WR', team: 'KC' },
    ])
    await bridgeRosterPlayersForLeague('lg', { dryRun: false })
    const slots = mocks.rrpCreate.mock.calls.map((c) => [c[0].data.playerId, c[0].data.slotType, c[0].data.acquisitionType])
    expect(slots).toEqual([['1', 'starter', 'imported'], ['2', 'bench', 'imported']])
  })

  it('never invents a player it could not resolve', async () => {
    mocks.rosterMany.mockResolvedValue([roster('g1', 'own1', ['ghost'])])
    mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'own1', ownerName: 'A', teamName: 'T' }])
    mocks.sportsMany.mockResolvedValue([])
    const r = await bridgeRosterPlayersForLeague('lg', { dryRun: false })
    expect(r.created).toBe(0)
    expect(r.unresolved).toEqual(['ghost'])
    expect(mocks.rrpCreate).not.toHaveBeenCalled()
  })

  it('writes nothing on a dry run', async () => {
    mocks.rosterMany.mockResolvedValue([roster('g1', 'own1', ['1'])])
    mocks.redraftMany.mockResolvedValue([{ id: 'r1', ownerId: 'own1', ownerName: 'A', teamName: 'T' }])
    mocks.sportsMany.mockResolvedValue([{ sleeperId: '1', sport: 'NFL', name: 'P', position: 'LB', team: 'KC' }])
    const r = await bridgeRosterPlayersForLeague('lg', { dryRun: true })
    expect(r.created).toBe(1)
    expect(mocks.rrpCreate).not.toHaveBeenCalled()
  })
})
