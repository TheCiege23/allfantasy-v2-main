// @vitest-environment node
/**
 * Guards committing the redraft and reconnecting the rebuilt leagues.
 *
 * 🛑 THE PLAN ALONE LEAVES THE TOURNAMENT STRANDED. `buildRedraftPlan`
 * recomputes every time it is asked — right for a preview, wrong once a
 * commissioner starts acting on it. They spend an evening building eight leagues
 * on the host platform from Tuesday's sheet; a late sync shifts the standings and
 * Thursday's plan names different people, with nothing recording which version
 * the leagues were built from.
 *
 * 🛑 AND THE BOARD CANNOT FOLLOW INTO ROUND 2 without slots pointing at the new
 * leagues — every read here is keyed on `TournamentLeague` rows for a round.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const shellFindFirst = vi.fn()
const roundFindMany = vi.fn()
const tlCount = vi.fn()
const tlFindFirst = vi.fn()
const tlCreateMany = vi.fn()
const tlUpdate = vi.fn()
const lpCreateMany = vi.fn()
const participantFindMany = vi.fn()
const leagueFindFirst = vi.fn()
const auditCreate = vi.fn()
const transaction = vi.fn()
const buildPlan = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tournamentShell: { findFirst: (...a: unknown[]) => shellFindFirst(...a) },
    tournamentRound: { findMany: (...a: unknown[]) => roundFindMany(...a) },
    tournamentLeague: {
      count: (...a: unknown[]) => tlCount(...a),
      findFirst: (...a: unknown[]) => tlFindFirst(...a),
      createMany: (...a: unknown[]) => tlCreateMany(...a),
      update: (...a: unknown[]) => tlUpdate(...a),
    },
    tournamentLeagueParticipant: { createMany: (...a: unknown[]) => lpCreateMany(...a) },
    tournamentParticipant: { findMany: (...a: unknown[]) => participantFindMany(...a) },
    league: { findFirst: (...a: unknown[]) => leagueFindFirst(...a) },
    tournamentAuditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))
vi.mock('@/lib/tournament/redraftPlan', () => ({
  buildRedraftPlan: (...a: unknown[]) => buildPlan(...a),
}))

import { attachRedraftLeague, commitRedraftPlan } from '@/lib/tournament/commitRedraft'

const ARGS = { tournamentId: 't1', commissionerUserId: 'commish' }

function manager(name: string) {
  return {
    participantId: `P-${name}`,
    displayName: name,
    seed: 1,
    fromLeague: 'BEAST',
    wins: 7,
    losses: 2,
    pointsFor: 1200,
  }
}

const PLAN = {
  tournamentId: 't1',
  fromRoundNumber: 1,
  teamsPerLeague: 2,
  totalAdvancers: 2,
  blockers: [],
  conferences: [
    {
      conferenceId: 'c-black',
      conferenceName: 'BLACK',
      advancerCount: 2,
      leagues: [{ name: 'BLACK NORTH', managers: [manager('TyT1'), manager('emmae')] }],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  buildPlan.mockResolvedValue(PLAN)
  shellFindFirst.mockResolvedValue({ id: 't1', currentRoundNumber: 1 })
  roundFindMany.mockResolvedValue([
    { id: 'r1', roundNumber: 1, roundType: 'opening' },
    { id: 'r2', roundNumber: 2, roundType: 'bubble' },
    { id: 'r3', roundNumber: 3, roundType: 'tournament' },
  ])
  tlCount.mockResolvedValue(0)
  tlFindFirst.mockResolvedValue(null)
  participantFindMany.mockResolvedValue([
    { id: 'P-TyT1', userId: 'sleeper-1' },
    { id: 'P-emmae', userId: 'sleeper-2' },
  ])
  transaction.mockResolvedValue([])
})

describe('committing the plan', () => {
  /**
   * 🛑 THE BUBBLE IS NOT THE NEXT STAGE. It has a week and an audience but is not
   * a play round — redrafting into it would put the whole field into a round
   * meant for twelve people.
   */
  it('targets the next PLAY round, skipping the bubble', async () => {
    const out = await commitRedraftPlan(ARGS)
    expect(out).toMatchObject({ ok: true, roundNumber: 3, leaguesCreated: 1, managersPlaced: 2 })
    expect(tlCreateMany.mock.calls[0][0].data[0].roundId).toBe('r3')
  })

  /**
   * ⚠ SLOTS ARE CREATED WITHOUT A LEAGUE, WHICH IS THE HONEST STATE: the decision
   * is made, the league does not exist yet.
   */
  it('creates forming slots with no league attached', async () => {
    await commitRedraftPlan(ARGS)
    const row = tlCreateMany.mock.calls[0][0].data[0]
    expect(row).toMatchObject({ name: 'BLACK NORTH', status: 'forming', teamSlots: 2 })
    expect(row.leagueId).toBeUndefined()
  })

  /**
   * ⚠ THE REAL IDENTITY IS COPIED, NOT INVENTED. `TournamentLeagueParticipant.userId`
   * is what the board matches on — a placeholder would leave every manager in
   * round 2 unmatched, which reads as a broken import.
   */
  it('carries each manager’s existing identity into the new round', async () => {
    await commitRedraftPlan(ARGS)
    const rows = lpCreateMany.mock.calls[0][0].data
    expect(rows.map((r: { userId: string }) => r.userId)).toEqual(['sleeper-1', 'sleeper-2'])
    expect(rows.every((r: { userId: string }) => !r.userId.startsWith('pending:'))).toBe(true)
  })

  it('refuses rather than committing placeholders when an identity is missing', async () => {
    participantFindMany.mockResolvedValue([{ id: 'P-TyT1', userId: 'sleeper-1' }])
    const out = await commitRedraftPlan(ARGS)
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(transaction).not.toHaveBeenCalled()
  })

  /** ⚠ The seed order is the point of the snake — losing it makes the assignment
      unreproducible from the record. */
  it('keeps the seeding order as the draft slot', async () => {
    await commitRedraftPlan(ARGS)
    expect(lpCreateMany.mock.calls[0][0].data.map((r: { draftSlot: number }) => r.draftSlot)).toEqual([1, 2])
  })

  /**
   * 🛑 COMMITTING TWICE would collide on the unique name halfway through and
   * leave a partly built round — and a commissioner who has already invited
   * people to BLACK NORTH would find a second one with a different sixteen.
   */
  it('refuses when the round already has slots', async () => {
    tlCount.mockResolvedValue(4)
    const out = await commitRedraftPlan(ARGS)
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('refuses when the plan has a blocker, quoting it', async () => {
    buildPlan.mockResolvedValue({
      ...PLAN,
      blockers: [{ code: 'not_advanced', severity: 'blocker', message: 'Run the cut first.' }],
    })
    const out = await commitRedraftPlan(ARGS)
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect((out as { error: string }).error).toBe('Run the cut first.')
  })

  /** A calendar with nothing after the opening round cannot be redrafted into. */
  it('says so when there is no later round to redraft into', async () => {
    roundFindMany.mockResolvedValue([{ id: 'r1', roundNumber: 1, roundType: 'opening' }])
    const out = await commitRedraftPlan(ARGS)
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect((out as { error: string }).error).toMatch(/calendar/i)
  })

  it('refuses a tournament this user does not commission', async () => {
    buildPlan.mockResolvedValue(null)
    expect(await commitRedraftPlan(ARGS)).toMatchObject({ ok: false, status: 404 })
  })
})

describe('attaching the rebuilt league', () => {
  beforeEach(() => {
    tlFindFirst
      .mockResolvedValueOnce({ id: 'slot1', name: 'BLACK NORTH', leagueId: null, round: { roundNumber: 3 } })
      .mockResolvedValueOnce(null)
    leagueFindFirst.mockResolvedValue({ id: 'lg-new', name: 'BLACK NORTH' })
  })

  it('points the slot at the league and marks it active', async () => {
    const out = await attachRedraftLeague({ ...ARGS, tournamentLeagueId: 'slot1', leagueId: 'lg-new' })
    expect(out).toMatchObject({ ok: true, roundNumber: 3 })
    expect(tlUpdate.mock.calls[0][0].data).toEqual({ leagueId: 'lg-new', status: 'active' })
  })

  /** ⚠ Scoped in the query — the slot id arrives in a request body. */
  it('scopes the slot lookup to this tournament', async () => {
    await attachRedraftLeague({ ...ARGS, tournamentLeagueId: 'slot1', leagueId: 'lg-new' })
    expect(tlFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'slot1', tournamentId: 't1' })
  })

  it('refuses a slot that already has a league', async () => {
    tlFindFirst.mockReset()
    tlFindFirst.mockResolvedValue({ id: 'slot1', name: 'BLACK NORTH', leagueId: 'lg-old', round: { roundNumber: 3 } })
    const out = await attachRedraftLeague({ ...ARGS, tournamentLeagueId: 'slot1', leagueId: 'lg-new' })
    expect(out).toMatchObject({ ok: false, status: 409 })
  })

  /** ⚠ Ownership applied to the query, so a stranger's league cannot be attached
      and then read through the board. */
  it('refuses a league that is not the commissioner’s', async () => {
    leagueFindFirst.mockResolvedValue(null)
    const out = await attachRedraftLeague({ ...ARGS, tournamentLeagueId: 'slot1', leagueId: 'someone-elses' })
    expect(out).toMatchObject({ ok: false, status: 404 })
    expect(leagueFindFirst.mock.calls[0][0].where.userId).toBe('commish')
  })

  /** 🛑 Name the league, not the column the constraint mentions. */
  it('names the slot already using that league', async () => {
    tlFindFirst.mockReset()
    tlFindFirst
      .mockResolvedValueOnce({ id: 'slot1', name: 'BLACK NORTH', leagueId: null, round: { roundNumber: 3 } })
      .mockResolvedValueOnce({ name: 'BLACK SOUTH' })
    const out = await attachRedraftLeague({ ...ARGS, tournamentLeagueId: 'slot1', leagueId: 'lg-new' })
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect((out as { error: string }).error).toContain('BLACK SOUTH')
  })
})
