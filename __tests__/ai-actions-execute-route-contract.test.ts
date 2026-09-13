import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const validateActionExecutionServerSideMock = vi.fn()
const executeAIActionMock = vi.fn()
const recordUnifiedMemoryInteractionMock = vi.fn()
const resolveActionLeagueWriteMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/chimmy-actions/AIActionServerValidation', () => ({
  validateActionExecutionServerSide: validateActionExecutionServerSideMock,
}))

vi.mock('@/lib/chimmy-actions/AIActionBindingService', () => ({
  executeAIAction: executeAIActionMock,
}))

vi.mock('@/lib/chimmy-actions/AIActionLeagueWriteContext', () => ({
  resolveActionLeagueWrite: resolveActionLeagueWriteMock,
}))

const LEAGUE_WRITE = {
  platform: 'espn',
  sourceLink: {
    href: 'https://fantasy.espn.com/football/league?leagueId=123',
    destinationType: 'league',
    provider: 'espn',
    providerLabel: 'ESPN Fantasy',
    label: 'Manage Waivers in Test League',
    isFallback: false,
    opensExternally: true,
  },
}

vi.mock('@/lib/ai-memory/unified-memory-system', () => ({
  recordUnifiedMemoryInteraction: recordUnifiedMemoryInteractionMock,
}))

function buildPayload() {
  return {
    action: {
      id: 'action-1',
      type: 'claim_player',
      label: 'Claim Now',
      description: 'Submit a waiver claim for this player',
      surface: 'waiver_wire',
      leagueId: 'league-1',
      teamId: 'team-1',
      sport: 'NFL',
      leagueType: 'redraft',
      safetyClass: 'confirmed',
      requiresConfirmation: true,
      requiresCommissioner: false,
      requiresPremium: false,
      requiredPermissions: ['member'],
      isAvailable: true,
      disabledReason: null,
      payload: { playerIds: ['player-1'] },
    },
    context: {
      role: 'member',
      sport: 'NFL',
      leagueType: 'redraft',
      leagueId: 'league-1',
      teamId: 'team-1',
      subscriptionState: {
        hasPremium: false,
        hasCommissioner: false,
        hasAdmin: false,
      },
      leagueState: {
        isLocked: false,
        isWaiverOpen: true,
        isLineupLocked: false,
        isDraftActive: false,
        isDraftComplete: true,
        isTradeDeadlinePast: false,
        isInPlayoffs: false,
      },
    },
  }
}

describe('POST /api/ai/actions/execute contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    validateActionExecutionServerSideMock.mockResolvedValue({
      allowed: true,
      status: 200,
      message: 'Action execution validated successfully.',
      issues: [],
      context: {
        userId: 'user-1',
        role: 'member',
        sport: 'NFL',
        leagueType: 'redraft',
        leagueId: 'league-1',
        teamId: 'team-1',
        subscriptionState: {
          hasPremium: false,
          hasCommissioner: false,
          hasAdmin: false,
        },
        leagueState: {
          isLocked: false,
          isWaiverOpen: true,
          isLineupLocked: false,
          isDraftActive: false,
          isDraftComplete: true,
          isTradeDeadlinePast: false,
          isInPlayoffs: false,
        },
      },
    })
    executeAIActionMock.mockResolvedValue({
      success: true,
      actionId: 'action-1',
      actionType: 'claim_player',
      message: 'Action "Claim Now" is ready.',
      data: {
        prefillTarget: 'waiver_claim_modal',
        prefillData: { playerId: 'player-1' },
        workflowPrefill: {
          workflowType: 'waiver_claim',
          values: { playerId: 'player-1' },
        },
      },
    })
    recordUnifiedMemoryInteractionMock.mockResolvedValue(undefined)
    resolveActionLeagueWriteMock.mockResolvedValue(LEAGUE_WRITE)
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/ai/actions/execute/route')
    const req = createMockNextRequest('http://localhost/api/ai/actions/execute', {
      method: 'POST',
      body: JSON.stringify(buildPayload()),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when server-side validation fails', async () => {
    validateActionExecutionServerSideMock.mockResolvedValueOnce({
      allowed: false,
      status: 400,
      message: 'Action execution validation failed.',
      issues: [{ code: 'missing_field', message: 'Missing required workflow prefill field: playerId.' }],
      context: {
        userId: 'user-1',
      },
    })

    const { POST } = await import('@/app/api/ai/actions/execute/route')
    const req = createMockNextRequest('http://localhost/api/ai/actions/execute', {
      method: 'POST',
      body: JSON.stringify(buildPayload()),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      message: 'Action execution validation failed.',
      issues: [{ code: 'missing_field' }],
    })
    expect(executeAIActionMock).not.toHaveBeenCalled()
  })

  it('returns success payload when execution passes', async () => {
    const { POST } = await import('@/app/api/ai/actions/execute/route')
    const req = createMockNextRequest('http://localhost/api/ai/actions/execute', {
      method: 'POST',
      body: JSON.stringify(buildPayload()),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      actionId: 'action-1',
      actionType: 'claim_player',
      data: {
        prefillTarget: 'waiver_claim_modal',
      },
    })
  })

  it('resolves the league write context from the AUTHORIZED league and passes it to staging', async () => {
    const allowed = await validateActionExecutionServerSideMock()
    validateActionExecutionServerSideMock.mockClear()
    validateActionExecutionServerSideMock.mockResolvedValueOnce({
      ...allowed,
      context: { ...allowed.context, leagueId: 'league-authorized' },
    })

    const { POST } = await import('@/app/api/ai/actions/execute/route')
    const req = createMockNextRequest('http://localhost/api/ai/actions/execute', {
      method: 'POST',
      body: JSON.stringify(buildPayload()),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(resolveActionLeagueWriteMock).toHaveBeenCalledWith('league-authorized', 'waiver_claim')
    expect(executeAIActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'claim_player' }),
      expect.objectContaining({ leagueId: 'league-authorized' }),
      LEAGUE_WRITE,
    )
  })

  it('records the action in memory as staged, not executed', async () => {
    const { POST } = await import('@/app/api/ai/actions/execute/route')
    const req = createMockNextRequest('http://localhost/api/ai/actions/execute', {
      method: 'POST',
      body: JSON.stringify(buildPayload()),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(recordUnifiedMemoryInteractionMock).toHaveBeenCalledTimes(1)
    expect(recordUnifiedMemoryInteractionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'action_staged',
        metadata: expect.objectContaining({ executed: false, writeScope: 'waiver_claim' }),
      }),
    )
  })
})
