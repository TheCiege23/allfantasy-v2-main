import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  assertLeagueActionGate: vi.fn(),
  isLeagueRosterDraftReady: vi.fn(),
  draftSessionFindUnique: vi.fn(),
  draftSessionUpdate: vi.fn(),
  draftPickDelete: vi.fn(),
  draftPickUpdate: vi.fn(),
  draftPickCreate: vi.fn(),
  draftPickAuditLogCreate: vi.fn(),
  rosterCount: vi.fn(),
  rosterFindMany: vi.fn(),
  prismaTransaction: vi.fn(),
  buildSessionSnapshot: vi.fn(),
  resetTimer: vi.fn(),
  invalidateLeagueDraftCaches: vi.fn(),
  validateRosterFitForDraftPick: vi.fn(),
  validateSpecialtyDraftPools: vi.fn(),
  validateC2CEligibilityAsync: vi.fn(),
  validateDevyEligibilityAsync: vi.fn(),
  resolveDraftPickPresentation: vi.fn(),
  getDraftUISettingsForLeague: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/server/services/leagueActionGate', () => ({
  assertLeagueActionGate: hm.assertLeagueActionGate,
}))

vi.mock('@/lib/league/league-roster-draft-gate', () => ({
  isLeagueRosterDraftReady: hm.isLeagueRosterDraftReady,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: hm.prismaTransaction,
    draftSession: {
      findUnique: hm.draftSessionFindUnique,
      findFirst: hm.draftSessionFindUnique,
      update: hm.draftSessionUpdate,
    },
    draftPick: {
      delete: hm.draftPickDelete,
      update: hm.draftPickUpdate,
      create: hm.draftPickCreate,
    },
    draftPickAuditLog: { create: hm.draftPickAuditLogCreate },
    roster: { count: hm.rosterCount },
  },
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: hm.buildSessionSnapshot,
  resetTimer: hm.resetTimer,
}))

vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({
  invalidateLeagueDraftCaches: hm.invalidateLeagueDraftCaches,
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({
  validateRosterFitForDraftPick: hm.validateRosterFitForDraftPick,
}))

vi.mock('@/lib/live-draft-engine/SpecialtyDraftPoolValidation', () => ({
  validateSpecialtyDraftPools: hm.validateSpecialtyDraftPools,
  parseDispersalPoolConfig: () => null,
}))

vi.mock('@/lib/live-draft-engine/PickValidation', () => ({
  validateC2CEligibilityAsync: hm.validateC2CEligibilityAsync,
  validateDevyEligibilityAsync: hm.validateDevyEligibilityAsync,
}))

vi.mock('@/lib/live-draft-engine/resolveDraftPickPresentation', () => ({
  resolveDraftPickPresentation: hm.resolveDraftPickPresentation,
  isSyntheticDraftPlayerId: () => false,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: hm.getDraftUISettingsForLeague,
}))

vi.mock('@/lib/draft-room', () => ({
  getManagerColorBySeed: () => ({ tintHex: '#abcdef' }),
}))

vi.mock('@/lib/live-draft-engine/auth', () => ({
  getCurrentUserRosterIdForLeague: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({
  getOrphanRosterIdsForLeague: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/provider-config', () => ({
  getProviderStatus: () => ({ anyAi: false }),
}))

vi.mock('@/lib/league/roster-configuration-gate-error', () => ({
  rosterConfigurationIncompleteBody: () => ({ error: 'Roster configuration incomplete' }),
}))

function makeSession(overrides: Record<string, unknown> = {}) {
  const teamCount = 12
  const slotOrder = Array.from({ length: teamCount }, (_, i) => ({
    slot: i + 1,
    rosterId: `roster-${i + 1}`,
    displayName: `Team ${i + 1}`,
  }))
  return {
    id: 'ds-1',
    leagueId: 'league-1',
    status: 'paused',
    draftType: 'snake',
    rounds: 15,
    teamCount,
    thirdRoundReversal: false,
    slotOrder,
    tradedPicks: [],
    sportType: 'NFL',
    playerPool: 'all',
    draftModeLabel: null,
    dispersalPoolConfig: null,
    devyConfig: null,
    c2cConfig: null,
    league: { id: 'league-1', sport: 'NFL' },
    picks: [
      {
        id: 'pick-1',
        overall: 1,
        round: 1,
        slot: 1,
        rosterId: 'roster-1',
        displayName: 'Team 1',
        playerName: 'Old Player',
        position: 'RB',
        team: 'DAL',
        byeWeek: 9,
        playerId: 'old-pid',
        playerImageUrl: null,
        tradedPickMeta: null,
        originalRosterId: 'roster-1',
        source: 'user',
        assetType: 'player',
        pickMetadata: null,
      },
    ],
    ...overrides,
  }
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return { id: 'ds-1', leagueId: 'league-1', version: 5, ...overrides }
}

async function callRoute(body: Record<string, unknown>) {
  const { POST } = await import(
    '@/app/api/leagues/[leagueId]/draft/commissioner/pick-edit/route'
  )
  const req = createMockNextRequest(
    'http://localhost/api/leagues/league-1/draft/commissioner/pick-edit',
    { method: 'POST', body },
  )
  return POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  hm.getServerSession.mockResolvedValue({ user: { id: 'commish-1' } })
  hm.assertLeagueActionGate.mockResolvedValue({ ok: true })
  hm.isLeagueRosterDraftReady.mockResolvedValue(true)
  hm.draftSessionFindUnique.mockResolvedValue(makeSession())
  hm.buildSessionSnapshot.mockResolvedValue(makeSnapshot())
  hm.resetTimer.mockResolvedValue(true)
  hm.invalidateLeagueDraftCaches.mockReturnValue(undefined)
  hm.validateRosterFitForDraftPick.mockResolvedValue({ valid: true })
  hm.validateSpecialtyDraftPools.mockReturnValue({ valid: true })
  hm.validateC2CEligibilityAsync.mockResolvedValue({ valid: true })
  hm.validateDevyEligibilityAsync.mockResolvedValue({ valid: true })
  hm.resolveDraftPickPresentation.mockResolvedValue({
    playerId: 'new-pid',
    playerImageUrl: 'https://cdn/new.png',
  })
  hm.getDraftUISettingsForLeague.mockResolvedValue({
    tradedPickColorModeEnabled: false,
    tradedPickOwnerNameRedEnabled: false,
  })
  hm.draftPickAuditLogCreate.mockResolvedValue({ id: 'audit-1' })
  hm.draftPickDelete.mockResolvedValue({})
  hm.draftPickUpdate.mockResolvedValue({})
  hm.draftPickCreate.mockResolvedValue({ id: 'new-pick-id' })
  hm.draftSessionUpdate.mockResolvedValue({})
  hm.rosterCount.mockResolvedValue(1)
  hm.rosterFindMany.mockResolvedValue([])

  hm.prismaTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      draftSession: {
        findUnique: hm.draftSessionFindUnique,
        findFirst: hm.draftSessionFindUnique,
        update: hm.draftSessionUpdate,
      },
      draftPick: {
        delete: hm.draftPickDelete,
        update: hm.draftPickUpdate,
        create: hm.draftPickCreate,
      },
      draftPickAuditLog: { create: hm.draftPickAuditLogCreate },
      roster: { count: hm.rosterCount, findMany: hm.rosterFindMany },
      devyPlayer: { findFirst: vi.fn().mockResolvedValue(null) },
    }
    return fn(tx)
  })
})

describe('POST /api/leagues/[leagueId]/draft/commissioner/pick-edit', () => {
  it('rejects unauthenticated requests with 401', async () => {
    hm.getServerSession.mockResolvedValue(null)
    const res = await callRoute({ action: 'REMOVE_PLAYER_FROM_PICK', overallPickNumber: 1 })
    expect(res.status).toBe(401)
  })

  it('rejects non-commissioner with 403', async () => {
    hm.assertLeagueActionGate.mockResolvedValue({
      ok: false,
      err: { status: 403, error: 'Forbidden', code: 'FORBIDDEN' },
    })
    const res = await callRoute({ action: 'REMOVE_PLAYER_FROM_PICK', overallPickNumber: 1 })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
  })

  it('rejects unsupported action with 400', async () => {
    const res = await callRoute({ action: 'NUKE_PICK', overallPickNumber: 1 })
    expect(res.status).toBe(400)
  })

  it('rejects when draft is not paused', async () => {
    hm.draftSessionFindUnique.mockResolvedValue(makeSession({ status: 'in_progress' }))
    const res = await callRoute({ action: 'REMOVE_PLAYER_FROM_PICK', overallPickNumber: 1 })
    expect(res.status).toBe(400)
    expect(hm.draftPickDelete).not.toHaveBeenCalled()
  })

  it('REMOVE: clears pick in place, increments version, writes audit, returns snapshot', async () => {
    const res = await callRoute({
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 1,
      reason: 'wrong player',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.session).toMatchObject({ id: 'ds-1' })
    expect(hm.draftPickUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pick-1' },
        data: expect.objectContaining({
          playerName: '',
          position: 'EMPTY',
          playerId: null,
        }),
      }),
    )
    expect(hm.draftSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: { increment: 1 } }),
      }),
    )
    expect(hm.draftPickAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'REMOVE_PLAYER_FROM_PICK',
          actorUserId: 'commish-1',
          oldPlayerId: 'old-pid',
          oldPlayerName: 'Old Player',
          reason: 'wrong player',
        }),
      }),
    )
    expect(hm.invalidateLeagueDraftCaches).toHaveBeenCalledWith('league-1')
  })

  it('REMOVE allows clearing any drafted pick (not only the latest)', async () => {
    const sess = makeSession()
    sess.picks.push({
      ...sess.picks[0],
      id: 'pick-2',
      overall: 2,
      slot: 2,
      rosterId: 'roster-2',
      playerName: 'Pick Two',
    })
    hm.draftSessionFindUnique.mockResolvedValue(sess)
    const res = await callRoute({ action: 'REMOVE_PLAYER_FROM_PICK', overallPickNumber: 1 })
    expect(res.status).toBe(200)
    expect(hm.draftPickUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pick-1' } }),
    )
  })

  it('REPLACE: updates pick with new player + presentation, creates audit', async () => {
    const res = await callRoute({
      action: 'REPLACE_PLAYER_ON_PICK',
      overallPickNumber: 1,
      playerName: 'New Player',
      position: 'WR',
      team: 'KC',
    })
    expect(res.status).toBe(200)
    expect(hm.draftPickUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pick-1' },
        data: expect.objectContaining({
          playerName: 'New Player',
          position: 'WR',
          team: 'KC',
          playerId: 'new-pid',
          playerImageUrl: 'https://cdn/new.png',
        }),
      }),
    )
    expect(hm.draftPickAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'REPLACE_PLAYER_ON_PICK',
          oldPlayerName: 'Old Player',
          newPlayerName: 'New Player',
        }),
      }),
    )
  })

  it('REPLACE refuses player already drafted elsewhere', async () => {
    const sess = makeSession()
    sess.picks.push({
      ...sess.picks[0],
      id: 'pick-2',
      overall: 2,
      slot: 2,
      rosterId: 'roster-2',
      playerName: 'Duplicate',
    })
    hm.draftSessionFindUnique.mockResolvedValue(sess)
    const res = await callRoute({
      action: 'REPLACE_PLAYER_ON_PICK',
      overallPickNumber: 1,
      playerName: 'duplicate',
      position: 'RB',
    })
    expect(res.status).toBe(409)
    expect(hm.draftPickUpdate).not.toHaveBeenCalled()
  })

  it('REPLACE returns 409 ROSTER_ELIGIBILITY warning unless force=true', async () => {
    hm.validateRosterFitForDraftPick.mockResolvedValue({ valid: false, error: 'No K slot' })
    const res = await callRoute({
      action: 'REPLACE_PLAYER_ON_PICK',
      overallPickNumber: 1,
      playerName: 'Justin Tucker',
      position: 'K',
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('ROSTER_ELIGIBILITY')
    expect(body.warnings?.[0]?.message).toBe('No K slot')
    expect(hm.draftPickUpdate).not.toHaveBeenCalled()
  })

  it('REPLACE with force=true bypasses roster-fit warning', async () => {
    hm.validateRosterFitForDraftPick.mockResolvedValue({ valid: false, error: 'No K slot' })
    const res = await callRoute({
      action: 'REPLACE_PLAYER_ON_PICK',
      overallPickNumber: 1,
      playerName: 'Justin Tucker',
      position: 'K',
      force: true,
    })
    expect(res.status).toBe(200)
    expect(hm.draftPickUpdate).toHaveBeenCalled()
    expect(hm.draftPickAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ forced: true }),
        }),
      }),
    )
  })

  it('ASSIGN to next open pick creates a new pick row + audit', async () => {
    hm.draftSessionFindUnique.mockResolvedValue(makeSession({ picks: [] }))
    const res = await callRoute({
      action: 'ASSIGN_PLAYER_TO_PICK',
      overallPickNumber: 1,
      playerName: 'Star RB',
      position: 'RB',
      team: 'SF',
    })
    expect(res.status).toBe(200)
    expect(hm.draftPickCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'ds-1',
          overall: 1,
          round: 1,
          slot: 1,
          rosterId: 'roster-1',
          playerName: 'Star RB',
          position: 'RB',
          team: 'SF',
          source: 'commissioner',
          playerId: 'new-pid',
          playerImageUrl: 'https://cdn/new.png',
        }),
      }),
    )
    expect(hm.draftPickAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ASSIGN_PLAYER_TO_PICK', newPlayerName: 'Star RB' }),
      }),
    )
  })

  it('ASSIGN refuses already-drafted player (409)', async () => {
    const res = await callRoute({
      action: 'ASSIGN_PLAYER_TO_PICK',
      overallPickNumber: 2,
      playerName: 'Old Player',
      position: 'RB',
    })
    expect(res.status).toBe(409)
    expect(hm.draftPickCreate).not.toHaveBeenCalled()
  })

  it('ASSIGN allows any in-range overall (no longer limited to next open pick)', async () => {
    hm.draftSessionFindUnique.mockResolvedValue(makeSession({ picks: [] }))
    const res = await callRoute({
      action: 'ASSIGN_PLAYER_TO_PICK',
      overallPickNumber: 5,
      playerName: 'Star RB',
      position: 'RB',
    })
    expect(res.status).toBe(200)
    expect(hm.draftPickCreate).toHaveBeenCalled()
  })

  it('CHANGE_PICK_OWNER updates session.tradedPicks and pick.rosterId', async () => {
    const res = await callRoute({
      action: 'CHANGE_PICK_OWNER',
      overallPickNumber: 1,
      newRosterId: 'roster-7',
    })
    expect(res.status).toBe(200)
    const sessUpdate = hm.draftSessionUpdate.mock.calls[0]?.[0]
    expect(sessUpdate?.data?.tradedPicks).toEqual([
      expect.objectContaining({
        round: 1,
        originalRosterId: 'roster-1',
        newRosterId: 'roster-7',
        newOwnerName: 'Team 7',
      }),
    ])
    expect(sessUpdate?.data?.version).toEqual({ increment: 1 })
    expect(hm.draftPickUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pick-1' },
        data: expect.objectContaining({ rosterId: 'roster-7' }),
      }),
    )
    expect(hm.draftPickAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CHANGE_PICK_OWNER',
          oldRosterId: 'roster-1',
          newRosterId: 'roster-7',
        }),
      }),
    )
  })

  it('CHANGE_PICK_OWNER rejects unknown roster (400)', async () => {
    hm.rosterCount.mockResolvedValue(0)
    const res = await callRoute({
      action: 'CHANGE_PICK_OWNER',
      overallPickNumber: 1,
      newRosterId: 'roster-999',
    })
    expect(res.status).toBe(400)
    expect(hm.draftSessionUpdate).not.toHaveBeenCalled()
  })

  it('rejects when overallPickNumber missing (400)', async () => {
    const res = await callRoute({ action: 'REMOVE_PLAYER_FROM_PICK' })
    expect(res.status).toBe(400)
  })
})
