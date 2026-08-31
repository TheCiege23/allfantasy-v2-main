// @vitest-environment node
/**
 * Guards the commissioner's manual manager→team link.
 *
 * 🛑 THIS IS THE ONE WRITE ON THE HUB, and it decides whose season the standings
 * describe. A wrong link does not error — both managers show a record, one of
 * them somebody else's — so the guards here are about refusing the wrong write
 * rather than reporting it afterwards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const shellFindFirst = vi.fn()
const lpFindFirst = vi.fn()
const leagueTeamFindFirst = vi.fn()
const participantFindFirst = vi.fn()
const transaction = vi.fn()
const participantUpdate = vi.fn()
const lpUpdateMany = vi.fn()
const auditCreate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tournamentShell: { findFirst: (...a: unknown[]) => shellFindFirst(...a) },
    tournamentLeagueParticipant: {
      findFirst: (...a: unknown[]) => lpFindFirst(...a),
      updateMany: (...a: unknown[]) => lpUpdateMany(...a),
    },
    leagueTeam: { findFirst: (...a: unknown[]) => leagueTeamFindFirst(...a) },
    tournamentParticipant: {
      findFirst: (...a: unknown[]) => participantFindFirst(...a),
      update: (...a: unknown[]) => participantUpdate(...a),
    },
    tournamentAuditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))

import { linkParticipantToTeam } from '@/lib/tournament/linkManager'

const ARGS = {
  tournamentId: 't1',
  commissionerUserId: 'commish',
  leagueParticipantId: 'lp1',
  externalId: '7',
}

beforeEach(() => {
  vi.clearAllMocks()
  shellFindFirst.mockResolvedValue({ id: 't1' })
  lpFindFirst.mockResolvedValue({
    id: 'lp1',
    participantId: 'P1',
    userId: 'stale-id',
    league: { leagueId: 'lg1' },
  })
  leagueTeamFindFirst.mockResolvedValue({
    externalId: '7',
    platformUserId: 'sleeper-77',
    ownerName: 'TyT1',
    teamName: 'Beasts',
  })
  participantFindFirst.mockResolvedValue(null)
  transaction.mockResolvedValue([])
})

/** ⚠ Same answer for "no such tournament" and "not yours". */
it('refuses a tournament this user does not commission', async () => {
  shellFindFirst.mockResolvedValue(null)
  const out = await linkParticipantToTeam(ARGS)
  expect(out).toEqual({ ok: false, error: 'Tournament not found', status: 404 })
})

/**
 * 🛑 THE PARTICIPANT ID ARRIVES IN A REQUEST BODY, so the tournament scope has
 * to be applied to the QUERY that finds it. An unscoped lookup checked after the
 * fact lets a commissioner of one tournament rewrite a participant in another's.
 */
it('scopes the participant lookup to this tournament in the query itself', async () => {
  await linkParticipantToTeam(ARGS)
  expect(lpFindFirst.mock.calls[0][0].where).toEqual({
    id: 'lp1',
    league: { tournamentId: 't1' },
  })
})

it('refuses a participant that is not in this tournament', async () => {
  lpFindFirst.mockResolvedValue(null)
  const out = await linkParticipantToTeam(ARGS)
  expect(out).toMatchObject({ ok: false, status: 404 })
})

describe('which identity gets written', () => {
  it('uses the platform user id when the import captured one', async () => {
    const out = await linkParticipantToTeam(ARGS)
    expect(out).toEqual({ ok: true, userId: 'sleeper-77' })
  })

  /**
   * 🛑 `LeagueTeam.platformUserId` IS NULLABLE, and an orphan team is exactly the
   * row most likely to need linking by hand. A link that could only say "this
   * manager is that Sleeper user" would be unable to fix them.
   */
  it('falls back to a pointer at the team row when there is no platform id', async () => {
    leagueTeamFindFirst.mockResolvedValue({
      externalId: '7',
      platformUserId: null,
      ownerName: '',
      teamName: 'Orphan',
    })
    const out = await linkParticipantToTeam(ARGS)
    expect(out).toEqual({ ok: true, userId: 'team:lg1:7' })
  })

  it('is a no-op when the manager is already linked to that team', async () => {
    lpFindFirst.mockResolvedValue({
      id: 'lp1',
      participantId: 'P1',
      userId: 'sleeper-77',
      league: { leagueId: 'lg1' },
    })
    const out = await linkParticipantToTeam(ARGS)
    expect(out).toEqual({ ok: true, userId: 'sleeper-77' })
    expect(transaction).not.toHaveBeenCalled()
  })
})

/**
 * 🛑 ONE TEAM, ONE MANAGER. The unique constraint would reject this anyway, but a
 * raw constraint error reaches the commissioner as "unexpected error" — and what
 * they need is WHICH manager holds it, because one of the two links is wrong and
 * they have to decide which.
 */
it('names the manager already holding that team instead of surfacing a constraint error', async () => {
  participantFindFirst.mockResolvedValue({ displayName: 'emmae' })
  const out = await linkParticipantToTeam(ARGS)
  expect(out).toMatchObject({ ok: false, status: 409 })
  expect((out as { error: string }).error).toContain('emmae')
  expect(transaction).not.toHaveBeenCalled()
})

it('refuses when the tournament league has no imported league behind it yet', async () => {
  lpFindFirst.mockResolvedValue({
    id: 'lp1',
    participantId: 'P1',
    userId: 'x',
    league: { leagueId: null },
  })
  const out = await linkParticipantToTeam(ARGS)
  expect(out).toMatchObject({ ok: false, status: 400 })
})

it('refuses a team that is not in that league', async () => {
  leagueTeamFindFirst.mockResolvedValue(null)
  const out = await linkParticipantToTeam(ARGS)
  expect(out).toMatchObject({ ok: false, status: 404 })
})

/**
 * ⚠ BOTH IDENTITY ROWS, IN ONE TRANSACTION. `TournamentParticipant.userId` is
 * the tournament-wide identity; `TournamentLeagueParticipant.userId` is the
 * per-round copy the board matches on. Writing one without the other leaves a
 * manager linked this round and unlinked the next — which presents as the bug
 * coming back by itself after a redraft.
 */
it('writes both identity rows and an audit entry in a single transaction', async () => {
  await linkParticipantToTeam(ARGS)
  expect(transaction).toHaveBeenCalledTimes(1)
  expect(transaction.mock.calls[0][0]).toHaveLength(3)
  expect(participantUpdate).toHaveBeenCalledWith({
    where: { id: 'P1' },
    data: { userId: 'sleeper-77' },
  })
  expect(lpUpdateMany).toHaveBeenCalledWith({
    where: { participantId: 'P1' },
    data: { userId: 'sleeper-77' },
  })
})

/** The previous id is recorded, so a wrong link is traceable and reversible. */
it('records what the link replaced', async () => {
  await linkParticipantToTeam(ARGS)
  expect(auditCreate.mock.calls[0][0].data.data).toMatchObject({
    previousUserId: 'stale-id',
    newUserId: 'sleeper-77',
    externalId: '7',
  })
})
