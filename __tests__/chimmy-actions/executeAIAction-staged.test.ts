import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIAction, AIActionContext } from '@/lib/chimmy-actions/AIActionModel'
import type { SourceLink } from '@/lib/league-links/sourceLinkResolver'

const { logAIActionEventMock, validateActionExecutionMock } = vi.hoisted(() => ({
  logAIActionEventMock: vi.fn(),
  validateActionExecutionMock: vi.fn(),
}))

vi.mock('@/lib/chimmy-actions/AIActionLogger', () => ({
  logAIActionEvent: logAIActionEventMock,
}))

vi.mock('@/lib/chimmy-actions/AIActionExecutionValidator', () => ({
  validateActionExecution: validateActionExecutionMock,
}))

import { executeAIAction } from '@/lib/chimmy-actions/AIActionBindingService'

const HOST_LINK: SourceLink = {
  href: 'https://fantasy.espn.com/football/league?leagueId=123',
  destinationType: 'league',
  provider: 'espn',
  providerLabel: 'ESPN Fantasy',
  label: 'Manage Waivers in Test League',
  isFallback: false,
  opensExternally: true,
}

function buildAction(overrides: Partial<AIAction> = {}): AIAction {
  return {
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
    ...overrides,
  } as AIAction
}

const CONTEXT = {
  userId: 'user-1',
  role: 'member',
  sport: 'NFL',
  leagueType: 'redraft',
  leagueId: 'league-1',
  teamId: 'team-1',
  subscriptionState: { hasPremium: false, hasCommissioner: false, hasAdmin: false },
  leagueState: {
    isLocked: false,
    isWaiverOpen: true,
    isLineupLocked: false,
    isDraftActive: false,
    isDraftComplete: true,
    isTradeDeadlinePast: false,
    isInPlayoffs: false,
  },
} as unknown as AIActionContext

function loggedEvents(): string[] {
  return logAIActionEventMock.mock.calls.map(([event]) => event.event)
}

describe('executeAIAction reports staging, not completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateActionExecutionMock.mockImplementation((action: AIAction) => ({
      allowed: true,
      normalizedAction: action,
      issues: [],
    }))
  })

  it('stages a SHADOW league action, says nothing reached the host, and links to it', async () => {
    const result = await executeAIAction(buildAction(), CONTEXT, { platform: 'espn', sourceLink: HOST_LINK })

    expect(result).toMatchObject({
      success: true,
      outcome: 'staged',
      executed: false,
      writeScope: 'waiver_claim',
      writeAuthority: { authority: 'SHADOW', platform: 'espn', shadow: true },
      sourceLink: HOST_LINK,
    })
    expect(result.message).toContain('nothing has been sent to')
    expect(loggedEvents()).toEqual(['staged'])
  })

  it('stages a NATIVE league action without a host link', async () => {
    const result = await executeAIAction(buildAction(), CONTEXT, { platform: null, sourceLink: HOST_LINK })

    expect(result).toMatchObject({
      outcome: 'staged',
      executed: false,
      writeAuthority: { authority: 'NATIVE', shadow: false },
      sourceLink: null,
    })
    expect(result.message).toBe('"Claim Now" is staged — review and submit it to apply the change.')
    expect(loggedEvents()).toEqual(['staged'])
  })

  it('makes no authority claim when the league could not be resolved', async () => {
    const result = await executeAIAction(buildAction(), CONTEXT)

    expect(result).toMatchObject({ outcome: 'staged', executed: false, writeAuthority: null, sourceLink: null })
    expect(result.message).toBe('"Claim Now" is staged — review and submit it to apply the change.')
  })

  it('attaches no authority or link to an action that changes nothing', async () => {
    const result = await executeAIAction(
      buildAction({ type: 'analyze_trade', label: 'Analyze' }),
      CONTEXT,
      { platform: 'espn', sourceLink: HOST_LINK },
    )

    expect(result).toMatchObject({ outcome: 'staged', writeScope: null, writeAuthority: null, sourceLink: null })
    expect(result.message).toBe('Action "Analyze" is ready.')
  })

  it('reports a refused action as failed and never as staged', async () => {
    validateActionExecutionMock.mockImplementationOnce((action: AIAction) => ({
      allowed: false,
      normalizedAction: { ...action, disabledReason: 'Waivers are closed.' },
      issues: [{ code: 'waiver_closed', message: 'Waivers are closed.' }],
    }))

    const result = await executeAIAction(buildAction(), CONTEXT, { platform: 'espn', sourceLink: HOST_LINK })

    expect(result).toMatchObject({ success: false, outcome: 'failed', executed: false })
    expect(loggedEvents()).toEqual(['failed'])
  })
})
