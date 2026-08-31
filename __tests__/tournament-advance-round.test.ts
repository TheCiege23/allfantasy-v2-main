// @vitest-environment node
/**
 * Guards moving the tournament into its next round.
 *
 * 🛑 THE CALENDAR EXISTED AND NOTHING WALKED IT. The scaffold creates every
 * round, the redraft fills the next one with slots, attaching gives each slot a
 * league — and `currentRoundNumber` is still 1, which is the number every read
 * on the hub scopes to. The board would keep showing the regular season while
 * the real tournament played on without it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const shellFindFirst = vi.fn()
const shellUpdate = vi.fn()
const roundFindMany = vi.fn()
const roundUpdate = vi.fn()
const tlFindMany = vi.fn()
const auditCreate = vi.fn()
const transaction = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tournamentShell: {
      findFirst: (...a: unknown[]) => shellFindFirst(...a),
      update: (...a: unknown[]) => shellUpdate(...a),
    },
    tournamentRound: {
      findMany: (...a: unknown[]) => roundFindMany(...a),
      update: (...a: unknown[]) => roundUpdate(...a),
    },
    tournamentLeague: { findMany: (...a: unknown[]) => tlFindMany(...a) },
    tournamentAuditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))

import { advanceToNextRound, getRoundReadiness } from '@/lib/tournament/advanceRound'

const ARGS = { tournamentId: 't1', commissionerUserId: 'commish' }

beforeEach(() => {
  vi.clearAllMocks()
  shellFindFirst.mockResolvedValue({ id: 't1', currentRoundNumber: 1 })
  roundFindMany.mockResolvedValue([
    { id: 'r1', roundNumber: 1, roundType: 'opening', roundLabel: 'Regular season' },
    { id: 'r2', roundNumber: 2, roundType: 'bubble', roundLabel: 'Bubble' },
    { id: 'r3', roundNumber: 3, roundType: 'tournament', roundLabel: 'Elimination bracket' },
  ])
  tlFindMany.mockResolvedValue([
    { name: 'BLACK NORTH', leagueId: 'lg-a' },
    { name: 'BLACK SOUTH', leagueId: 'lg-b' },
  ])
  transaction.mockResolvedValue([])
})

describe('is the next round ready', () => {
  /** ⚠ The bubble has a week and an audience but is not the next stage. */
  it('looks past the bubble to the next play round', async () => {
    const out = await getRoundReadiness('t1', 'commish')
    expect(out).toMatchObject({
      nextRoundNumber: 3,
      nextRoundLabel: 'Elimination bracket',
      ready: true,
    })
  })

  it('is not ready when the round has no leagues yet', async () => {
    tlFindMany.mockResolvedValue([])
    const out = await getRoundReadiness('t1', 'commish')
    expect(out).toMatchObject({ ready: false })
    expect(out?.reason).toMatch(/record the redraft/i)
  })

  /**
   * 🛑 THE GUARD THAT MATTERS. Moving with three of eight leagues attached makes
   * the board read as though five leagues of managers have vanished — and the
   * next cut would be computed against a third of the field.
   */
  it('names the slots still waiting, and refuses', async () => {
    tlFindMany.mockResolvedValue([
      { name: 'BLACK NORTH', leagueId: 'lg-a' },
      { name: 'BLACK SOUTH', leagueId: null },
      { name: 'BLACK EAST', leagueId: null },
    ])
    const out = await getRoundReadiness('t1', 'commish')
    expect(out).toMatchObject({ ready: false, waitingForLeagues: ['BLACK SOUTH', 'BLACK EAST'] })
    expect(out?.reason).toContain('BLACK SOUTH')
  })

  it('says so at the end of the calendar', async () => {
    shellFindFirst.mockResolvedValue({ id: 't1', currentRoundNumber: 3 })
    const out = await getRoundReadiness('t1', 'commish')
    expect(out).toMatchObject({ nextRoundNumber: null, ready: false })
    expect(out?.reason).toMatch(/last round/i)
  })

  it('returns null for a tournament this user does not commission', async () => {
    shellFindFirst.mockResolvedValue(null)
    expect(await getRoundReadiness('t1', 'someone-else')).toBeNull()
  })
})

describe('moving into it', () => {
  it('stamps the new round on the shell', async () => {
    const out = await advanceToNextRound(ARGS)
    expect(out).toMatchObject({ ok: true, movedTo: 3 })
    expect(shellUpdate.mock.calls[0][0].data).toEqual({ currentRoundNumber: 3 })
  })

  /**
   * ⚠ THE OLD ROUND IS COMPLETED, NOT DELETED. Its leagues and every record in
   * them stay where they are; the board simply stops scoping to them. A
   * tournament that discards its own regular season cannot answer "how did I get
   * here", which is most of what a commissioner is asked in week 12.
   */
  it('completes the round it leaves and starts the one it enters', async () => {
    await advanceToNextRound(ARGS)
    const updates = roundUpdate.mock.calls.map((c) => [c[0].where.id, c[0].data.status])
    expect(updates).toEqual([
      ['r1', 'complete'],
      ['r3', 'active'],
    ])
  })

  it('refuses while any league is missing, and writes nothing', async () => {
    tlFindMany.mockResolvedValue([{ name: 'BLACK NORTH', leagueId: null }])
    const out = await advanceToNextRound(ARGS)
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('records the move', async () => {
    await advanceToNextRound(ARGS)
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      action: 'round.advanced',
      data: { from: 1, to: 3, leagues: 2 },
    })
  })
})
