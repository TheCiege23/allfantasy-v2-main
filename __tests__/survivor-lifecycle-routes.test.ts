import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getServerSessionMock,
  assertLeagueCommissionerMock,
  assertLeagueMemberMock,
  lockVotingMock,
  openTribalCouncilMock,
  submitVoteMock,
  playIdolMock,
  executeRocksDrawMock,
  removeRosterFromTribeChatMock,
  enrollInExileMock,
  enrollJuryMemberMock,
  shouldJoinJuryMock,
  postScrollRevealToTribeChatMock,
  postLeagueRevealFollowUpMock,
  openFinaleMock,
  openJuryPhaseMock,
  openJuryVotingMock,
  getFinaleStateMock,
  recordCrownedWinnerMock,
  submitJuryVoteMock,
  resolveSurvivorCurrentWeekMock,
  prismaMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  assertLeagueCommissionerMock: vi.fn(),
  assertLeagueMemberMock: vi.fn(),
  lockVotingMock: vi.fn(),
  openTribalCouncilMock: vi.fn(),
  submitVoteMock: vi.fn(),
  playIdolMock: vi.fn(),
  executeRocksDrawMock: vi.fn(),
  removeRosterFromTribeChatMock: vi.fn(),
  enrollInExileMock: vi.fn(),
  enrollJuryMemberMock: vi.fn(),
  shouldJoinJuryMock: vi.fn(),
  postScrollRevealToTribeChatMock: vi.fn(),
  postLeagueRevealFollowUpMock: vi.fn(),
  openFinaleMock: vi.fn(),
  openJuryPhaseMock: vi.fn(),
  openJuryVotingMock: vi.fn(),
  getFinaleStateMock: vi.fn(),
  recordCrownedWinnerMock: vi.fn(),
  submitJuryVoteMock: vi.fn(),
  resolveSurvivorCurrentWeekMock: vi.fn(),
  prismaMock: {
    survivorTribalCouncil: {
      findUnique: vi.fn(),
    },
    roster: {
      findFirst: vi.fn(),
    },
  },
}))

const { hostGuardMock } = vi.hoisted(() => ({ hostGuardMock: vi.fn(async () => null as Response | null) }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: hostGuardMock }))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/app/api/cron/_auth', () => ({
  requireCronAuth: vi.fn(() => true),
}))

vi.mock('@/lib/league/league-access', () => ({
  assertLeagueCommissioner: assertLeagueCommissionerMock,
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock('@/lib/survivor/votingEngine', () => ({
  lockVoting: lockVotingMock,
  openTribalCouncil: openTribalCouncilMock,
  submitVote: submitVoteMock,
}))

vi.mock('@/lib/survivor/idolEngine', () => ({
  playIdol: playIdolMock,
}))

vi.mock('@/lib/survivor/rocksEngine', () => ({
  executeRocksDraw: executeRocksDrawMock,
}))

vi.mock('@/lib/survivor/SurvivorChatMembershipService', () => ({
  removeRosterFromTribeChat: removeRosterFromTribeChatMock,
}))

vi.mock('@/lib/survivor/SurvivorExileEngine', () => ({
  enrollInExile: enrollInExileMock,
}))

vi.mock('@/lib/survivor/SurvivorJuryEngine', () => ({
  enrollJuryMember: enrollJuryMemberMock,
  shouldJoinJury: shouldJoinJuryMock,
}))

vi.mock('@/lib/survivor/leagueChatPoster', () => ({
  postScrollRevealToTribeChat: postScrollRevealToTribeChatMock,
  postLeagueRevealFollowUp: postLeagueRevealFollowUpMock,
}))

vi.mock('@/lib/survivor/juryEngine', () => ({
  openFinale: openFinaleMock,
  openJuryPhase: openJuryPhaseMock,
  openJuryVoting: openJuryVotingMock,
}))

vi.mock('@/lib/survivor/SurvivorFinaleEngine', () => ({
  submitJuryVote: submitJuryVoteMock,
  getFinaleState: getFinaleStateMock,
  settleFinaleIfDue: getFinaleStateMock,
  recordCrownedWinner: recordCrownedWinnerMock,
}))

vi.mock('@/lib/survivor/finaleView', () => ({ getFinaleRevealView: vi.fn() }))

vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({
  resolveSurvivorCurrentWeek: resolveSurvivorCurrentWeekMock,
}))

describe('Survivor tribal eliminate route behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1' } })
    assertLeagueCommissionerMock.mockResolvedValue({ ok: true })
  })

  it('wires eliminate action to real lock/elimination pipeline', async () => {
    const now = new Date('2026-04-20T12:00:00.000Z')
    ;(prismaMock.survivorTribalCouncil.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        leagueId: 'league-1',
        closedAt: null,
        eliminatedRosterId: null,
        status: 'voting_open',
      })
      .mockResolvedValueOnce({
        eliminatedRosterId: 'roster-x',
        closedAt: now,
        status: 'completed',
      })

    const { POST } = await import('@/app/api/survivor/tribal/route')
    const req = new Request('http://localhost/api/survivor/tribal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId: 'league-1', action: 'eliminate', councilId: 'c-1' }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(lockVotingMock).toHaveBeenCalledWith('c-1')
    expect(json).toEqual(
      expect.objectContaining({
        ok: true,
        eliminatedRosterId: 'roster-x',
        status: 'completed',
      }),
    )
  })

  it('returns alreadyClosed payload without re-locking', async () => {
    const closedAt = new Date('2026-04-20T13:00:00.000Z')
    ;(prismaMock.survivorTribalCouncil.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      leagueId: 'league-1',
      closedAt,
      eliminatedRosterId: 'roster-y',
      status: 'completed',
    })

    const { POST } = await import('@/app/api/survivor/tribal/route')
    const req = new Request('http://localhost/api/survivor/tribal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId: 'league-1', action: 'eliminate', councilId: 'c-2' }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(lockVotingMock).not.toHaveBeenCalled()
    expect(json).toEqual(
      expect.objectContaining({
        ok: true,
        alreadyClosed: true,
        eliminatedRosterId: 'roster-y',
      }),
    )
  })
})

describe('playing commissioner manual action restrictions', () => {
  it('blocks council elimination before executing a manual control', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'playing-owner' } })
    hostGuardMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Host required' }), { status: 403 }))
    lockVotingMock.mockClear()
    const { POST } = await import('@/app/api/survivor/tribal/route')
    const response = await POST(new Request('http://localhost/api/survivor/tribal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId: 'league-1', action: 'eliminate', councilId: 'c-1' }) }))
    expect(response.status).toBe(403)
    expect(lockVotingMock).not.toHaveBeenCalled()
  })
})

describe('Survivor jury vote route normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'juror-user' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
    resolveSurvivorCurrentWeekMock.mockResolvedValue(7)
  })

  it('uses strict SurvivorFinaleEngine submitJuryVote with roster IDs', async () => {
    ;(prismaMock.roster.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'juror-roster' })
      .mockResolvedValueOnce({ id: 'finalist-roster' })
    submitJuryVoteMock.mockResolvedValue({ ok: true, state: { open: true, votes: [{ jurorRosterId: 'other-juror', finalistRosterId: 'f' }], voteCount: { f: 1 } } })

    const { POST } = await import('@/app/api/survivor/jury/route')
    const req = new Request('http://localhost/api/survivor/jury', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'jury_vote',
        leagueId: 'league-1',
        finalistUserId: 'finalist-user',
      }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(submitJuryVoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        jurorRosterId: 'juror-roster',
        finalistRosterId: 'finalist-roster',
        week: 7,
        source: 'api.survivor.jury.route',
      }),
    )
    expect(json).toEqual(expect.objectContaining({ ok: true }))
    // A juror's submit must not receive anyone else's ballot or the running tally.
    expect(JSON.stringify(json)).not.toContain('other-juror')
    expect(json).not.toHaveProperty('state')
  })

  it('reveals only the winner the finale engine crowned', async () => {
    const { POST } = await import('@/app/api/survivor/jury/route')
    const reveal = () => POST(new Request('http://localhost/api/survivor/jury', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'reveal', leagueId: 'league-1' }),
    }) as never)
    getFinaleStateMock.mockResolvedValueOnce({ closed: false, winnerRosterId: null, votesSubmitted: 3, votesRequired: 7 })
    const pending = await reveal()
    expect(pending.status).toBe(409)
    expect(recordCrownedWinnerMock).not.toHaveBeenCalled()
    getFinaleStateMock.mockResolvedValueOnce({ closed: true, winnerRosterId: 'finalist-roster', votesSubmitted: 7, votesRequired: 7 })
    recordCrownedWinnerMock.mockResolvedValueOnce({ winnerUserId: 'finalist-user' })
    const done = await reveal()
    expect(await done.json()).toEqual({ winnerId: 'finalist-user' })
  })

  it('surfaces strict finale validation errors as 400', async () => {
    ;(prismaMock.roster.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'juror-roster' })
      .mockResolvedValueOnce({ id: 'finalist-roster' })
    submitJuryVoteMock.mockResolvedValue({ ok: false, error: 'Only jury members can cast final votes' })

    const { POST } = await import('@/app/api/survivor/jury/route')
    const req = new Request('http://localhost/api/survivor/jury', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'jury_vote',
        leagueId: 'league-1',
        finalistUserId: 'finalist-user',
      }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual(expect.objectContaining({ error: 'Only jury members can cast final votes' }))
  })
})
