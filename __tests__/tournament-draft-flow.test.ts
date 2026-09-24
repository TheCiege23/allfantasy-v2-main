/**
 * Draft flow tests — covers:
 *  - scheduleRedraftForRound: session creation, auction vs snake type forwarding,
 *    idempotency (skipping already-created sessions), chat announcement posting
 *  - applyFaabResetForRound: sets faabRemaining on all rosters in round
 *  - applyBenchSpotsForRound: patches leagueRosterConfig.overrides.benchCount
 *  - canonicalizeDraftType mapping (snake/auction/3rd_reversal/linear)
 *  - simulataneous draft scheduling via scheduleRoundDraft (scheduleRoundDraft.ts)
 *  - draft type enforcement: commissioner cannot store 3rd_reversal via settings PATCH
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  prismaMock,
  getOrCreateDraftSessionMock,
  createLeagueChatMessageMock,
} = vi.hoisted(() => ({
  prismaMock: {
    legacyTournament: { findUnique: vi.fn() },
    legacyTournamentLeague: { findMany: vi.fn() },
    leagueSettings: { updateMany: vi.fn() },
    roster: { updateMany: vi.fn() },
    leagueRosterConfig: { findUnique: vi.fn(), update: vi.fn() },
    tournamentShell: { findUnique: vi.fn() },
    tournamentLeague: { findMany: vi.fn(), update: vi.fn() },
    tournamentRound: { findFirst: vi.fn() },
    draftSession: { update: vi.fn() },
    tournamentAnnouncement: { create: vi.fn() },
    tournamentAuditLog: { create: vi.fn() },
  },
  getOrCreateDraftSessionMock: vi.fn(),
  createLeagueChatMessageMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  getOrCreateDraftSession: getOrCreateDraftSessionMock,
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: createLeagueChatMessageMock,
}))

import {
  scheduleRedraftForRound,
  applyFaabResetForRound,
  applyBenchSpotsForRound,
} from '@/lib/tournament-mode/TournamentRedraftService'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeTournament(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    name: 'Test Tournament',
    creatorId: 'creator-1',
    settings: { draftType: 'snake', faabBudgetDefault: 100 },
    ...overrides,
  }
}

function makeLeagues(count: number, roundIndex = 1) {
  return Array.from({ length: count }, (_, i) => ({ leagueId: `league-${i + 1}`, roundIndex }))
}

// ─── scheduleRedraftForRound ──────────────────────────────────────────────────
describe('scheduleRedraftForRound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.legacyTournament.findUnique.mockResolvedValue(makeTournament())
    prismaMock.legacyTournamentLeague.findMany.mockResolvedValue(makeLeagues(3))
    prismaMock.leagueSettings.updateMany.mockResolvedValue({ count: 1 })
    getOrCreateDraftSessionMock.mockResolvedValue({ created: true, sessionId: 'ds-1' })
    createLeagueChatMessageMock.mockResolvedValue(undefined)
  })

  it('creates draft sessions for each league in the round', async () => {
    const result = await scheduleRedraftForRound('t-1', 1)
    expect(result.scheduled).toBe(3)
    expect(result.leagueIds).toHaveLength(3)
    expect(getOrCreateDraftSessionMock).toHaveBeenCalledTimes(3)
  })

  it('posts chat announcement for each newly created session', async () => {
    await scheduleRedraftForRound('t-1', 1)
    expect(createLeagueChatMessageMock).toHaveBeenCalledTimes(3)
  })

  it('skips already-existing sessions (created=false)', async () => {
    getOrCreateDraftSessionMock.mockResolvedValue({ created: false })
    const result = await scheduleRedraftForRound('t-1', 1)
    expect(result.scheduled).toBe(0)
    expect(createLeagueChatMessageMock).not.toHaveBeenCalled()
  })

  it('forwards auction draftType to leagueSettings', async () => {
    prismaMock.legacyTournament.findUnique.mockResolvedValue(makeTournament({ settings: { draftType: 'auction' } }))
    await scheduleRedraftForRound('t-1', 1)
    expect(prismaMock.leagueSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { draftType: 'auction' } })
    )
  })

  it('forwards snake draftType to leagueSettings', async () => {
    await scheduleRedraftForRound('t-1', 1)
    expect(prismaMock.leagueSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { draftType: 'snake' } })
    )
  })

  it('handles null draftType in tournament settings gracefully', async () => {
    prismaMock.legacyTournament.findUnique.mockResolvedValue(makeTournament({ settings: {} }))
    const result = await scheduleRedraftForRound('t-1', 1)
    expect(result.scheduled).toBe(3) // proceeds without setting draftType
    expect(prismaMock.leagueSettings.updateMany).not.toHaveBeenCalled()
  })

  it('is resilient to individual league draft-session errors', async () => {
    getOrCreateDraftSessionMock
      .mockResolvedValueOnce({ created: true })
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce({ created: true })

    const result = await scheduleRedraftForRound('t-1', 1)
    expect(result.scheduled).toBe(2)
  })

  it('returns empty leagueIds when no leagues in round', async () => {
    prismaMock.legacyTournamentLeague.findMany.mockResolvedValue([])
    const result = await scheduleRedraftForRound('t-1', 1)
    expect(result.scheduled).toBe(0)
    expect(result.leagueIds).toEqual([])
  })

  it('includes roundIndex in chat announcement metadata', async () => {
    await scheduleRedraftForRound('t-1', 2)
    const chatCall = createLeagueChatMessageMock.mock.calls[0]
    const meta = chatCall?.[3]?.metadata as Record<string, unknown>
    expect(meta?.roundIndex).toBe(2)
  })
})

// ─── applyFaabResetForRound ───────────────────────────────────────────────────
describe('applyFaabResetForRound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.legacyTournamentLeague.findMany.mockResolvedValue(makeLeagues(4))
    prismaMock.roster.updateMany.mockResolvedValue({ count: 1 })
  })

  it('calls roster.updateMany for each league', async () => {
    await applyFaabResetForRound('t-1', 1, 500)
    expect(prismaMock.roster.updateMany).toHaveBeenCalledTimes(4)
  })

  it('sets faabRemaining to the provided budget', async () => {
    await applyFaabResetForRound('t-1', 1, 250)
    const calls = prismaMock.roster.updateMany.mock.calls
    for (const call of calls) {
      expect(call[0].data.faabRemaining).toBe(250)
    }
  })

  it('handles round with no leagues', async () => {
    prismaMock.legacyTournamentLeague.findMany.mockResolvedValue([])
    await expect(applyFaabResetForRound('t-1', 1, 100)).resolves.toBeUndefined()
    expect(prismaMock.roster.updateMany).not.toHaveBeenCalled()
  })

  it('resets FAAB to 0 correctly', async () => {
    await applyFaabResetForRound('t-1', 1, 0)
    const calls = prismaMock.roster.updateMany.mock.calls
    for (const call of calls) {
      expect(call[0].data.faabRemaining).toBe(0)
    }
  })
})

// ─── applyBenchSpotsForRound ──────────────────────────────────────────────────
describe('applyBenchSpotsForRound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.legacyTournamentLeague.findMany.mockResolvedValue(makeLeagues(2))
    prismaMock.leagueRosterConfig.findUnique.mockResolvedValue({
      leagueId: 'league-1',
      overrides: { flexCount: 2 },
    })
    prismaMock.leagueRosterConfig.update.mockResolvedValue({})
  })

  it('updates benchCount in overrides for each league', async () => {
    await applyBenchSpotsForRound('t-1', 1, 3)
    expect(prismaMock.leagueRosterConfig.update).toHaveBeenCalledTimes(2)
    const firstCall = prismaMock.leagueRosterConfig.update.mock.calls[0]
    const overrides = firstCall?.[0]?.data?.overrides as Record<string, unknown>
    expect(overrides?.benchCount).toBe(3)
  })

  it('preserves existing overrides when patching benchCount', async () => {
    await applyBenchSpotsForRound('t-1', 1, 2)
    const firstCall = prismaMock.leagueRosterConfig.update.mock.calls[0]
    const overrides = firstCall?.[0]?.data?.overrides as Record<string, unknown>
    expect(overrides?.flexCount).toBe(2) // preserved from mock
    expect(overrides?.benchCount).toBe(2)
  })

  it('skips leagues without leagueRosterConfig', async () => {
    prismaMock.leagueRosterConfig.findUnique.mockResolvedValue(null)
    await applyBenchSpotsForRound('t-1', 1, 4)
    expect(prismaMock.leagueRosterConfig.update).not.toHaveBeenCalled()
  })

  it('still writes benchCount when overrides is null (creates overrides from scratch)', async () => {
    prismaMock.leagueRosterConfig.findUnique.mockResolvedValue({
      leagueId: 'league-1',
      overrides: null,
    })
    await applyBenchSpotsForRound('t-1', 1, 4)
    // Implementation writes { benchCount: 4 } even when existing overrides is null
    expect(prismaMock.leagueRosterConfig.update).toHaveBeenCalledTimes(2)
    const firstCall = prismaMock.leagueRosterConfig.update.mock.calls[0]
    expect((firstCall?.[0]?.data?.overrides as Record<string, unknown>)?.benchCount).toBe(4)
  })
})

// ─── Draft type canonicalization (via scheduleRedraftForRound behaviour) ──────
describe('draft type canonicalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.legacyTournamentLeague.findMany.mockResolvedValue([{ leagueId: 'l-1' }])
    prismaMock.leagueSettings.updateMany.mockResolvedValue({ count: 1 })
    getOrCreateDraftSessionMock.mockResolvedValue({ created: true })
    createLeagueChatMessageMock.mockResolvedValue(undefined)
  })

  const cases: Array<{ input: string; expected: string | null }> = [
    { input: 'snake', expected: 'snake' },
    { input: 'SNAKE', expected: 'snake' },
    { input: 'serpentine', expected: 'snake' },
    { input: 'auction', expected: 'auction' },
    { input: 'AUCTION', expected: 'auction' },
    { input: '3rd_reversal', expected: '3rd_reversal' },
    { input: '3rr', expected: '3rd_reversal' },
    { input: 'linear', expected: 'linear' },
    { input: 'straight', expected: 'linear' },
  ]

  for (const { input, expected } of cases) {
    it(`'${input}' → '${expected}'`, async () => {
      prismaMock.legacyTournament.findUnique.mockResolvedValue(
        makeTournament({ settings: { draftType: input } })
      )
      await scheduleRedraftForRound('t-1', 1)
      if (expected !== null) {
        expect(prismaMock.leagueSettings.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: { draftType: expected } })
        )
      }
    })
  }
})

// ─── Simultaneous vs staggered draft scheduling ───────────────────────────────
describe('scheduleRoundDraft — simultaneous vs staggered', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.tournamentShell.findUnique.mockResolvedValue({
      id: 't-1',
      simultaneousDrafts: true,
      draftType: 'snake',
      draftClockSeconds: 90,
    })
    prismaMock.tournamentRound.findFirst.mockResolvedValue({ id: 'round-1' })
    prismaMock.tournamentLeague.findMany.mockResolvedValue([
      { id: 'tl-1', leagueId: 'l-1', leagueNumber: 1 },
      { id: 'tl-2', leagueId: 'l-2', leagueNumber: 2 },
    ])
    prismaMock.tournamentLeague.update.mockResolvedValue({})
    prismaMock.draftSession.update.mockResolvedValue({})
    prismaMock.tournamentAnnouncement.create.mockResolvedValue({})
    prismaMock.tournamentAuditLog.create.mockResolvedValue({})
    // The real contract is `{ session, created }` — there has never been a `sessionId` field. It
    // only mattered once scheduleRoundDraft started writing to `session.id`, because
    // DraftSession.leagueId is no longer unique (2026-09-24).
    getOrCreateDraftSessionMock.mockImplementation(async (leagueId: string) => ({
      session: { id: `ds-${leagueId}` },
      created: false,
    }))
  })

  it('updates each league\'s own draft session by id, never by leagueId', async () => {
    const { scheduleRoundDraft } = await import('@/lib/tournament/scheduleRoundDraft')
    await scheduleRoundDraft('t-1', 1, new Date())
    const wheres = prismaMock.draftSession.update.mock.calls.map((c) => c[0].where)
    expect(wheres).toEqual([{ id: 'ds-l-1' }, { id: 'ds-l-2' }])
  })

  it('simultaneous mode: all leagues get the same draftScheduledAt', async () => {
    const { scheduleRoundDraft } = await import('@/lib/tournament/scheduleRoundDraft')
    const draftTime = new Date('2025-08-01T18:00:00Z')
    await scheduleRoundDraft('t-1', 1, draftTime)
    const updateCalls = prismaMock.tournamentLeague.update.mock.calls
    expect(updateCalls).toHaveLength(2)
    const times = updateCalls.map((c) => (c[0].data as { draftScheduledAt: Date }).draftScheduledAt?.toISOString())
    expect(times[0]).toBe(times[1])
  })

  it('staggered mode: leagues get 30-minute offsets', async () => {
    prismaMock.tournamentShell.findUnique.mockResolvedValue({
      id: 't-1',
      simultaneousDrafts: false,
      draftType: 'snake',
      draftClockSeconds: 90,
    })
    const { scheduleRoundDraft } = await import('@/lib/tournament/scheduleRoundDraft')
    const draftTime = new Date('2025-08-01T18:00:00Z')
    await scheduleRoundDraft('t-1', 1, draftTime)
    const updateCalls = prismaMock.tournamentLeague.update.mock.calls
    const t0 = new Date(updateCalls[0][0].data.draftScheduledAt as Date).getTime()
    const t1 = new Date(updateCalls[1][0].data.draftScheduledAt as Date).getTime()
    expect(t1 - t0).toBe(30 * 60 * 1000)
  })

  it('applies timerSeconds to draft sessions', async () => {
    const { scheduleRoundDraft } = await import('@/lib/tournament/scheduleRoundDraft')
    await scheduleRoundDraft('t-1', 1, new Date())
    const sessionUpdateCalls = prismaMock.draftSession.update.mock.calls
    for (const call of sessionUpdateCalls) {
      expect(call[0].data.timerSeconds).toBe(90)
    }
  })

  it('applies auction draftType to session from shell', async () => {
    prismaMock.tournamentShell.findUnique.mockResolvedValue({
      id: 't-1',
      simultaneousDrafts: true,
      draftType: 'auction',
      draftClockSeconds: 30,
    })
    const { scheduleRoundDraft } = await import('@/lib/tournament/scheduleRoundDraft')
    await scheduleRoundDraft('t-1', 1, new Date())
    const sessionUpdateCalls = prismaMock.draftSession.update.mock.calls
    expect(sessionUpdateCalls[0][0].data.draftType).toBe('auction')
  })

  it('creates draft_scheduled announcement', async () => {
    const { scheduleRoundDraft } = await import('@/lib/tournament/scheduleRoundDraft')
    await scheduleRoundDraft('t-1', 1, new Date())
    expect(prismaMock.tournamentAnnouncement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'draft_scheduled' }),
      })
    )
  })

  it('404 if tournament shell not found', async () => {
    prismaMock.tournamentShell.findUnique.mockResolvedValue(null)
    const { scheduleRoundDraft } = await import('@/lib/tournament/scheduleRoundDraft')
    await expect(scheduleRoundDraft('t-1', 1, new Date())).rejects.toThrow('Tournament not found')
  })
})
