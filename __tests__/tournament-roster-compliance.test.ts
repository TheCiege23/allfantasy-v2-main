// @vitest-environment node
/**
 * Guards the cross-league roster-rule sweep.
 *
 * 🛑 NOBODY POLICES TWENTY LEAGUES BY HAND, so a uniform rule — a roster cap, no
 * IR — exists on paper and is never enforced. The risk in automating it is the
 * opposite of the usual one: a check that quietly skips what it cannot read
 * reports a clean sweep, and a clean sweep is exactly what stops anyone looking.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const shellFindFirst = vi.fn()
const roundFindFirst = vi.fn()
const tlFindMany = vi.fn()
const rosterFindMany = vi.fn()
const teamFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tournamentShell: { findFirst: (...a: unknown[]) => shellFindFirst(...a) },
    tournamentRound: { findFirst: (...a: unknown[]) => roundFindFirst(...a) },
    tournamentLeague: { findMany: (...a: unknown[]) => tlFindMany(...a) },
    roster: { findMany: (...a: unknown[]) => rosterFindMany(...a) },
    leagueTeam: { findMany: (...a: unknown[]) => teamFindMany(...a) },
  },
}))

import { checkTournamentRosterCompliance } from '@/lib/tournament/rosterCompliance'
import { resolveRoundRosterSize } from '@/lib/tournament/rosterRules'

const SHELL = {
  id: 't1',
  currentRoundNumber: 1,
  openingRosterSize: 15,
  tournamentRosterSize: 10,
  eliteRosterSize: 8,
  irEnabled: false,
  tradeEnabled: false,
}

function roster(platformUserId: string, players: string[], reserve: string[] = []) {
  return { leagueId: 'lg1', platformUserId, playerData: { players, reserve } }
}

beforeEach(() => {
  vi.clearAllMocks()
  shellFindFirst.mockResolvedValue(SHELL)
  roundFindFirst.mockResolvedValue({ roundNumber: 1, roundType: 'opening', rosterSizeOverride: null })
  tlFindMany.mockResolvedValue([{ leagueId: 'lg1', name: 'BEAST' }])
  teamFindMany.mockResolvedValue([
    { leagueId: 'lg1', platformUserId: 's-1', ownerName: 'TyT1', teamName: 'Beasts' },
  ])
  rosterFindMany.mockResolvedValue([roster('s-1', Array.from({ length: 15 }, (_, i) => `p${i}`))])
})

it('refuses a tournament this user does not commission', async () => {
  shellFindFirst.mockResolvedValue(null)
  expect(await checkTournamentRosterCompliance('t1', 'someone-else')).toBeNull()
})

describe('the roster cap', () => {
  it('passes a roster exactly on the limit', async () => {
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.rosterLimit).toBe(15)
    expect(out!.violations).toEqual([])
  })

  it('flags a roster over the limit, naming the handle a commissioner would @', async () => {
    rosterFindMany.mockResolvedValue([
      roster('s-1', Array.from({ length: 17 }, (_, i) => `p${i}`)),
    ])
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.violations[0]).toMatchObject({
      kind: 'roster_too_large',
      displayName: 'TyT1',
      observed: 17,
      limit: 15,
    })
  })

  /**
   * 🛑 SLEEPER PADS EMPTY LINEUP SLOTS WITH "0". Counting those inflates every
   * roster by however many slots are unfilled, and reports a violation against a
   * manager who is comfortably under the cap.
   */
  it('does not count Sleeper’s "0" padding as rostered players', async () => {
    rosterFindMany.mockResolvedValue([
      roster('s-1', [...Array.from({ length: 15 }, (_, i) => `p${i}`), '0', '0', '']),
    ])
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.violations).toEqual([])
  })

  /** ⚠ The limit comes from the shared resolver, not a second copy of the rule. */
  it('uses the round’s own limit, override first', async () => {
    roundFindFirst.mockResolvedValue({ roundNumber: 3, roundType: 'elite', rosterSizeOverride: 9 })
    shellFindFirst.mockResolvedValue({ ...SHELL, currentRoundNumber: 3 })
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.rosterLimit).toBe(9)
    expect(
      resolveRoundRosterSize(SHELL, { roundNumber: 3, roundType: 'elite', rosterSizeOverride: 9 }),
    ).toBe(9)
  })
})

describe('IR', () => {
  it('flags an occupied IR slot when the tournament forbids it', async () => {
    rosterFindMany.mockResolvedValue([roster('s-1', ['a', 'b'], ['x'])])
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.violations[0]).toMatchObject({ kind: 'ir_used', observed: 1 })
  })

  it('says nothing about IR when the tournament allows it', async () => {
    shellFindFirst.mockResolvedValue({ ...SHELL, irEnabled: true })
    rosterFindMany.mockResolvedValue([roster('s-1', ['a'], ['x'])])
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.violations).toEqual([])
  })
})

describe('what it refuses to call clean', () => {
  /**
   * ⚠ UNREADABLE IS NOT COMPLIANT. Skipping a roster we cannot parse quietly
   * shrinks the field being policed, and that manager is the one worth looking
   * at.
   */
  it('reports an unreadable roster rather than passing it', async () => {
    rosterFindMany.mockResolvedValue([{ leagueId: 'lg1', platformUserId: 's-1', playerData: {} }])
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.violations[0]).toMatchObject({ kind: 'no_roster', observed: null })
  })

  it('names leagues with no rosters at all, which is a sync problem not a clean sweep', async () => {
    tlFindMany.mockResolvedValue([
      { leagueId: 'lg1', name: 'BEAST' },
      { leagueId: 'lg2', name: 'GOAT' },
    ])
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.leaguesWithoutRosters).toEqual(['GOAT'])
  })

  /**
   * 🛑 A RULE IT CANNOT SEE IS NAMED, NOT OMITTED. A completed trade reaches
   * AllFantasy as two rosters that changed between syncs, with nothing recording
   * that a trade caused it — so silence would assert "no trade violations",
   * which there is no evidence for.
   */
  it('declares the no-trades rule unenforceable instead of implying it passed', async () => {
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.unenforceable[0].rule).toMatch(/trade/i)
    expect(out!.unenforceable[0].reason).toMatch(/between syncs/i)
  })

  it('says nothing about trades when the tournament allows them', async () => {
    shellFindFirst.mockResolvedValue({ ...SHELL, tradeEnabled: true })
    const out = await checkTournamentRosterCompliance('t1', 'commish')
    expect(out!.unenforceable).toEqual([])
  })
})
