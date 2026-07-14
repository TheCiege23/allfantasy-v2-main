// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  isLeagueRosterDraftReady: vi.fn(),
  buildSessionSnapshot: vi.fn(),
  invalidateLeagueDraftCaches: vi.fn(),
  getDraftUISettingsForLeague: vi.fn(),
  resolveDraftPickPresentation: vi.fn(),
  validateRosterFitForDraftPick: vi.fn(),
  txFindUnique: vi.fn(),
  txDelete: vi.fn(),
  txUpdatePick: vi.fn(),
  txCreatePick: vi.fn(),
  txAuditCreate: vi.fn(),
  txSessionUpdate: vi.fn(),
  txRosterCount: vi.fn(),
  txRosterFindMany: vi.fn(),
  resolveCurrentOnTheClock: vi.fn(),
  resetTimer: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/league/league-roster-draft-gate', () => ({
  isLeagueRosterDraftReady: hm.isLeagueRosterDraftReady,
}))

vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({
  invalidateLeagueDraftCaches: hm.invalidateLeagueDraftCaches,
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: hm.buildSessionSnapshot,
  resetTimer: hm.resetTimer,
}))

vi.mock('@/lib/live-draft-engine/CurrentOnTheClockResolver', () => ({
  resolveCurrentOnTheClock: hm.resolveCurrentOnTheClock,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: hm.getDraftUISettingsForLeague,
}))

vi.mock('@/lib/live-draft-engine/resolveDraftPickPresentation', () => ({
  resolveDraftPickPresentation: hm.resolveDraftPickPresentation,
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({
  validateRosterFitForDraftPick: hm.validateRosterFitForDraftPick,
}))

vi.mock('@/lib/live-draft-engine/SpecialtyDraftPoolValidation', () => ({
  validateSpecialtyDraftPools: vi.fn().mockReturnValue({ valid: true }),
}))

vi.mock('@/lib/live-draft-engine/PickValidation', () => ({
  validateC2CEligibilityAsync: vi.fn().mockResolvedValue({ valid: true }),
  validateDevyEligibilityAsync: vi.fn().mockResolvedValue({ valid: true }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: hm.transaction,
  },
}))

import { commissionerPickEdit } from '@/lib/live-draft-engine/commissioner/commissionerPickEditService'

function basePick(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pick-1',
    overall: 1,
    round: 1,
    slot: 1,
    rosterId: 'r1',
    displayName: 'T1',
    playerName: 'Alpha',
    position: 'QB',
    team: 'KC',
    byeWeek: 7,
    playerId: 'player-1',
    playerImageUrl: 'https://img.example/a.png',
    tradedPickMeta: null,
    originalRosterId: 'r1',
    assetType: 'player',
    pickMetadata: null,
    source: 'user',
    ...overrides,
  }
}

function pausedSession(picks: unknown[]) {
  return {
    id: 'sess-1',
    leagueId: 'league-1',
    status: 'paused',
    draftType: 'snake',
    thirdRoundReversal: false,
    teamCount: 2,
    rounds: 15,
    slotOrder: [
      { slot: 1, rosterId: 'r1', displayName: 'T1' },
      { slot: 2, rosterId: 'r2', displayName: 'T2' },
    ],
    tradedPicks: [],
    picks,
    sportType: 'NFL',
    league: { id: 'league-1', sport: 'NFL' },
  }
}

describe('commissionerPickEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.isLeagueRosterDraftReady.mockResolvedValue(true)
    hm.getDraftUISettingsForLeague.mockResolvedValue({
      tradedPickOwnerNameRedEnabled: false,
      tradedPickColorModeEnabled: false,
    })
    hm.buildSessionSnapshot.mockResolvedValue({
      id: 'sess-1',
      leagueId: 'league-1',
      status: 'paused',
      version: 7,
      draftType: 'snake',
      rounds: 15,
      teamCount: 2,
      thirdRoundReversal: false,
      timerSeconds: 90,
      timerEndAt: null,
      pausedRemainingSeconds: 60,
      slotOrder: pausedSession([]).slotOrder,
      tradedPicks: [],
      picks: [],
      currentPick: null,
      timer: { label: 'paused', remainingSeconds: 60, totalSeconds: 90 },
      updatedAt: new Date().toISOString(),
    } as any)
    hm.invalidateLeagueDraftCaches.mockImplementation(() => {})
    hm.resetTimer.mockResolvedValue(true)
    hm.resolveCurrentOnTheClock.mockReturnValue(null)
    hm.txRosterFindMany.mockResolvedValue([])
    hm.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<boolean>) => {
      const tx = {
        draftSession: {
          findUnique: hm.txFindUnique,
          update: hm.txSessionUpdate,
        },
        draftPick: {
          delete: hm.txDelete,
          update: hm.txUpdatePick,
          create: hm.txCreatePick,
        },
        draftPickAuditLog: { create: hm.txAuditCreate },
        roster: { count: hm.txRosterCount, findMany: hm.txRosterFindMany },
        devyPlayer: { findFirst: vi.fn().mockResolvedValue(null) },
      }
      return fn(tx as any)
    })
  })

  it('rejects when draft is not paused', async () => {
    hm.txFindUnique.mockResolvedValue({ ...pausedSession([basePick()]), status: 'in_progress' })
    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 1,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.status).toBe(400)
    expect(hm.txAuditCreate).not.toHaveBeenCalled()
  })

  it('REMOVE_PLAYER_FROM_PICK clears middle pick in place (no delete)', async () => {
    hm.txFindUnique.mockResolvedValue(
      pausedSession([
        basePick({ overall: 1, id: 'pick-a', slot: 1 }),
        basePick({ overall: 2, id: 'pick-b', slot: 2, playerName: 'Mid', position: 'TE' }),
      ]),
    )
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 1,
    })
    expect(out.ok).toBe(true)
    expect(hm.txUpdatePick).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pick-a' },
        data: expect.objectContaining({
          position: 'EMPTY',
          playerName: '',
          pickMetadata: { pickEditorEmpty: true },
        }),
      }),
    )
    expect(hm.txDelete).not.toHaveBeenCalled()
  })

  it('REMOVE_PLAYER_FROM_PICK clears pick, writes audit, bumps version', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([basePick()]))
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 1,
      reason: 'undo mistake',
    })
    expect(out.ok).toBe(true)
    expect(hm.txUpdatePick).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pick-1' },
        data: expect.objectContaining({ position: 'EMPTY' }),
      }),
    )
    expect(hm.txAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'REMOVE_PLAYER_FROM_PICK',
          actorUserId: 'comm-1',
          overallPickNumber: 1,
          oldPlayerName: 'Alpha',
        }),
      }),
    )
    expect(hm.txSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: { increment: 1 } }),
      }),
    )
    expect(hm.invalidateLeagueDraftCaches).toHaveBeenCalledWith('league-1')
  })

  it('REPLACE rejects on empty pick cell', async () => {
    hm.txFindUnique.mockResolvedValue(
      pausedSession([
        {
          ...basePick(),
          playerName: '',
          position: 'EMPTY',
          pickMetadata: { pickEditorEmpty: true },
        },
      ]),
    )
    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REPLACE_PLAYER_ON_PICK',
      overallPickNumber: 1,
      playerName: 'X',
      position: 'RB',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.status).toBe(400)
    expect(hm.txUpdatePick).not.toHaveBeenCalled()
  })

  it('REPLACE returns 409 roster eligibility unless force', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([basePick()]))
    hm.validateRosterFitForDraftPick.mockResolvedValue({ valid: false, error: 'Roster would exceed maximum size (16 slots).' })

    const blocked = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REPLACE_PLAYER_ON_PICK',
      overallPickNumber: 1,
      playerName: 'Beta',
      position: 'RB',
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.status).toBe(409)
      expect(blocked.code).toBe('ROSTER_ELIGIBILITY')
    }
    expect(hm.txUpdatePick).not.toHaveBeenCalled()

    hm.validateRosterFitForDraftPick.mockResolvedValue({ valid: false, error: 'Roster would exceed maximum size (16 slots).' })
    hm.resolveDraftPickPresentation.mockResolvedValue({ playerId: 'ext-2', playerImageUrl: 'https://img.example/b.png' })
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const forced = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REPLACE_PLAYER_ON_PICK',
      overallPickNumber: 1,
      playerName: 'Beta',
      position: 'RB',
      force: true,
    })
    expect(forced.ok).toBe(true)
    expect(hm.txUpdatePick).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          playerName: 'Beta',
          position: 'RB',
          playerId: 'ext-2',
          playerImageUrl: 'https://img.example/b.png',
        }),
      }),
    )
    const meta = hm.txAuditCreate.mock.calls[0][0].data.metadata as Record<string, unknown>
    expect(meta.forced).toBe(true)
    expect(meta.eligibilityForced).toBe(true)
  })

  it('ASSIGN_PLAYER_TO_PICK fills an empty existing row', async () => {
    hm.txFindUnique.mockResolvedValue(
      pausedSession([
        {
          ...basePick({ overall: 1 }),
          playerName: '',
          position: 'EMPTY',
          pickMetadata: { pickEditorEmpty: true },
        },
      ]),
    )
    hm.validateRosterFitForDraftPick.mockResolvedValue({ valid: true })
    hm.resolveDraftPickPresentation.mockResolvedValue({ playerId: 'ext-fill', playerImageUrl: 'https://img.example/f.png' })
    hm.txUpdatePick.mockResolvedValue({ id: 'pick-1' })
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'ASSIGN_PLAYER_TO_PICK',
      overallPickNumber: 1,
      playerName: 'Filled',
      position: 'QB',
    })
    expect(out.ok).toBe(true)
    expect(hm.txCreatePick).not.toHaveBeenCalled()
    expect(hm.txUpdatePick).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          playerName: 'Filled',
          playerId: 'ext-fill',
          position: 'QB',
        }),
      }),
    )
  })

  it('ASSIGN_PLAYER_TO_PICK creates missing overall pick with presentation fields', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([]))
    hm.validateRosterFitForDraftPick.mockResolvedValue({ valid: true })
    hm.resolveDraftPickPresentation.mockResolvedValue({ playerId: 'ext-9', playerImageUrl: 'https://img.example/9.png' })
    hm.txCreatePick.mockResolvedValue({ id: 'new-pick' })
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'ASSIGN_PLAYER_TO_PICK',
      overallPickNumber: 1,
      playerName: 'Gamma',
      position: 'WR',
    })
    expect(out.ok).toBe(true)
    expect(hm.txCreatePick).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          overall: 1,
          playerName: 'Gamma',
          playerId: 'ext-9',
          playerImageUrl: 'https://img.example/9.png',
          source: 'commissioner',
        }),
      }),
    )
  })

  it('CHANGE_PICK_OWNER appends tradedPicks and updates rosterId', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([basePick()]))
    hm.txRosterCount.mockResolvedValue(1)
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'CHANGE_PICK_OWNER',
      overallPickNumber: 1,
      newRosterId: 'r2',
    })
    expect(out.ok).toBe(true)
    expect(hm.txUpdatePick).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rosterId: 'r2' }),
      }),
    )
    expect(hm.txSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tradedPicks: expect.arrayContaining([
            expect.objectContaining({
              round: 1,
              originalRosterId: 'r1',
              newRosterId: 'r2',
            }),
          ]),
        }),
      }),
    )
  })

  it('CHANGE_PICK_OWNER works on an empty cleared pick', async () => {
    hm.txFindUnique.mockResolvedValue(
      pausedSession([
        {
          ...basePick(),
          playerName: '',
          position: 'EMPTY',
          pickMetadata: { pickEditorEmpty: true },
        },
      ]),
    )
    hm.txRosterCount.mockResolvedValue(1)
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'CHANGE_PICK_OWNER',
      overallPickNumber: 1,
      newRosterId: 'r2',
    })
    expect(out.ok).toBe(true)
    expect(hm.txUpdatePick).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rosterId: 'r2' }),
      }),
    )
  })

  it('blocks assigning a player already on the board', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([basePick({ overall: 1, playerId: 'dup', playerName: 'Dup' })]))
    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'ASSIGN_PLAYER_TO_PICK',
      overallPickNumber: 2,
      playerName: 'Dup',
      position: 'TE',
      playerId: 'dup',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.status).toBe(409)
  })

  it('REMOVE current on-clock pick resets timer', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([basePick({ overall: 1 })]))
    hm.resolveCurrentOnTheClock.mockReturnValue({ overall: 1 })
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 1,
    })
    expect(out.ok).toBe(true)
    expect(hm.resetTimer).toHaveBeenCalledWith('league-1')
  })

  it('REMOVE past pick resets timer because it rewinds the on-clock cursor', async () => {
    hm.txFindUnique.mockResolvedValue(
      pausedSession([
        basePick({ overall: 1, id: 'pick-1' }),
        basePick({ overall: 2, id: 'pick-2', slot: 2, rosterId: 'r2' }),
      ]),
    )
    hm.resolveCurrentOnTheClock.mockReturnValue({ overall: 2 })
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 1,
    })
    expect(out.ok).toBe(true)
    expect(hm.resetTimer).toHaveBeenCalledWith('league-1')
  })

  it('REMOVE future populated pick resets timer because the draft cursor may move to that pick', async () => {
    hm.txFindUnique.mockResolvedValue(
      pausedSession([
        basePick({ overall: 1, id: 'pick-1' }),
        basePick({ overall: 2, id: 'pick-2', slot: 2, rosterId: 'r2' }),
        basePick({ overall: 3, id: 'pick-3', round: 2, slot: 2, rosterId: 'r2' }),
      ]),
    )
    hm.resolveCurrentOnTheClock.mockReturnValue({ overall: 2 })
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 3,
    })
    expect(out.ok).toBe(true)
    expect(hm.resetTimer).toHaveBeenCalledWith('league-1')
  })

  it('ASSIGN current on-clock pick resets timer', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([]))
    hm.resolveCurrentOnTheClock.mockReturnValue({ overall: 1 })
    hm.validateRosterFitForDraftPick.mockResolvedValue({ valid: true })
    hm.resolveDraftPickPresentation.mockResolvedValue({ playerId: 'ext-1', playerImageUrl: null })
    hm.txCreatePick.mockResolvedValue({ id: 'pick-1' })
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'ASSIGN_PLAYER_TO_PICK',
      overallPickNumber: 1,
      playerName: 'Now On Clock',
      position: 'WR',
    })
    expect(out.ok).toBe(true)
    expect(hm.resetTimer).toHaveBeenCalledWith('league-1')
  })

  it('ASSIGN past/future pick does not reset timer', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([]))
    hm.resolveCurrentOnTheClock.mockReturnValue({ overall: 1 })
    hm.validateRosterFitForDraftPick.mockResolvedValue({ valid: true })
    hm.resolveDraftPickPresentation.mockResolvedValue({ playerId: 'ext-2', playerImageUrl: null })
    hm.txCreatePick.mockResolvedValue({ id: 'pick-2' })
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'ASSIGN_PLAYER_TO_PICK',
      overallPickNumber: 2,
      playerName: 'Not On Clock',
      position: 'TE',
    })
    expect(out.ok).toBe(true)
    expect(hm.resetTimer).not.toHaveBeenCalled()
  })

  it('CHANGE_PICK_OWNER current empty pick resets timer', async () => {
    hm.txFindUnique.mockResolvedValue(
      pausedSession([
        {
          ...basePick(),
          playerName: '',
          position: 'EMPTY',
          pickMetadata: { pickEditorEmpty: true },
        },
      ]),
    )
    hm.resolveCurrentOnTheClock.mockReturnValue({ overall: 1 })
    hm.txRosterCount.mockResolvedValue(1)
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'CHANGE_PICK_OWNER',
      overallPickNumber: 1,
      newRosterId: 'r2',
    })
    expect(out.ok).toBe(true)
    expect(hm.resetTimer).toHaveBeenCalledWith('league-1')
  })

  it('CHANGE_PICK_OWNER future empty pick does not reset timer', async () => {
    hm.txFindUnique.mockResolvedValue(
      pausedSession([
        basePick({ overall: 1, id: 'pick-1' }),
        {
          ...basePick({ overall: 3, id: 'pick-3', round: 2, slot: 1 }),
          playerName: '',
          position: 'EMPTY',
          pickMetadata: { pickEditorEmpty: true },
        },
      ]),
    )
    hm.resolveCurrentOnTheClock.mockReturnValue({ overall: 2 })
    hm.txRosterCount.mockResolvedValue(1)
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'CHANGE_PICK_OWNER',
      overallPickNumber: 3,
      newRosterId: 'r2',
    })
    expect(out.ok).toBe(true)
    expect(hm.resetTimer).not.toHaveBeenCalled()
  })

  it('CHANGE_PICK_OWNER filled pick does not reset timer', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([basePick({ overall: 1 })]))
    hm.resolveCurrentOnTheClock.mockReturnValue({ overall: 1 })
    hm.txRosterCount.mockResolvedValue(1)
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'CHANGE_PICK_OWNER',
      overallPickNumber: 1,
      newRosterId: 'r2',
    })
    expect(out.ok).toBe(true)
    expect(hm.resetTimer).not.toHaveBeenCalled()
  })

  it('self-benefit without confirmation is rejected', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([basePick({ overall: 1, rosterId: 'r1' })]))
    hm.txRosterFindMany.mockResolvedValue([{ id: 'r1', platformUserId: 'comm-1' }])

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 1,
      reason: 'cleanup',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.status).toBe(409)
      expect(out.code).toBe('SELF_BENEFIT_CONFIRM_REQUIRED')
    }
  })

  it('self-benefit with confirmation is allowed and writes metadata', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([basePick({ overall: 1, rosterId: 'r1' })]))
    hm.txRosterFindMany.mockResolvedValue([{ id: 'r1', platformUserId: 'comm-1' }])
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 1,
      reason: 'Fixing my own mistaken autopick',
      confirmSelfBenefit: true,
    })
    expect(out.ok).toBe(true)
    const meta = hm.txAuditCreate.mock.calls.at(-1)?.[0]?.data?.metadata as Record<string, unknown>
    expect(meta.selfBenefit).toBe(true)
    expect(meta.selfBenefitConfirmed).toBe(true)
    expect(meta.selfBenefitReason).toBe('Fixing my own mistaken autopick')
  })

  it('self-benefit with typed CONFIRM is allowed', async () => {
    hm.txFindUnique.mockResolvedValue(pausedSession([basePick({ overall: 1, rosterId: 'r1' })]))
    hm.txRosterFindMany.mockResolvedValue([{ id: 'r1', platformUserId: 'comm-1' }])
    hm.txUpdatePick.mockResolvedValue({})
    hm.txAuditCreate.mockResolvedValue({})
    hm.txSessionUpdate.mockResolvedValue({})

    const out = await commissionerPickEdit({
      leagueId: 'league-1',
      actorUserId: 'comm-1',
      action: 'REMOVE_PLAYER_FROM_PICK',
      overallPickNumber: 1,
      reason: 'CONFIRM',
    })
    expect(out.ok).toBe(true)
  })
})
