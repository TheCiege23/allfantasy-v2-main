import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindUniqueMock = vi.fn()
const leagueUpdateMock = vi.fn()
const aiAlertCountMock = vi.fn()
const aiAlertFindManyMock = vi.fn()
const integrityFlagCountMock = vi.fn()
const draftSessionFindUniqueMock = vi.fn()
const actionLogFindManyMock = vi.fn()
const engagementCreateMock = vi.fn()

const ensureAICommissionerConfigMock = vi.fn()
const appendAICommissionerActionLogMock = vi.fn()
const runAICommissionerCycleMock = vi.fn()
const toConfigViewMock = vi.fn()
const analyzeLeagueGovernanceMock = vi.fn()
const createPlatformNotificationMock = vi.fn()
const resolveForUserMock = vi.fn()
const settingsPatchMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      update: leagueUpdateMock,
    },
    aiCommissionerAlert: {
      count: aiAlertCountMock,
      findMany: aiAlertFindManyMock,
    },
    integrityFlag: {
      count: integrityFlagCountMock,
    },
    draftSession: {
      findUnique: draftSessionFindUniqueMock,
      findFirst: draftSessionFindUniqueMock,
    },
    aiCommissionerActionLog: {
      findMany: actionLogFindManyMock,
    },
    engagementEvent: {
      create: engagementCreateMock,
    },
  },
}))

vi.mock('@/lib/ai-commissioner/AICommissionerService', () => ({
  ensureAICommissionerConfig: ensureAICommissionerConfigMock,
  appendAICommissionerActionLog: appendAICommissionerActionLogMock,
  runAICommissionerCycle: runAICommissionerCycleMock,
  toConfigView: toConfigViewMock,
}))

vi.mock('@/lib/league/execute-league-settings-patch', () => ({
  executeLeagueSettingsPatch: settingsPatchMock,
}))

vi.mock('@/lib/ai-commissioner/LeagueGovernanceAnalyzer', () => ({
  analyzeLeagueGovernance: analyzeLeagueGovernanceMock,
}))

vi.mock('@/lib/platform/notification-service', () => ({
  createPlatformNotification: createPlatformNotificationMock,
}))

vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser = resolveForUserMock
  },
}))

describe('UnifiedCommissionerSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    appendAICommissionerActionLogMock.mockResolvedValue(undefined)
    createPlatformNotificationMock.mockResolvedValue(undefined)
    engagementCreateMock.mockResolvedValue(undefined)
    resolveForUserMock.mockResolvedValue({
      entitlement: {
        plans: ['commissioner'],
        status: 'active',
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      hasAccess: true,
      message: 'Access granted.',
    })
    ensureAICommissionerConfigMock.mockResolvedValue({
      remindersEnabled: true,
      collusionMonitoringEnabled: true,
      inactivityMonitoringEnabled: true,
      commissionerNotificationMode: 'in_app',
    })
    toConfigViewMock.mockReturnValue({ commissionerNotificationMode: 'in_app' })
  })

  it('requires explicit confirmation before applying any action', async () => {
    const { applyUnifiedCommissionerAction } = await import('../lib/ai-commissioner/UnifiedCommissionerSystem')

    const result = await applyUnifiedCommissionerAction({
      leagueId: 'league-1',
      userId: 'user-1',
      actionKey: 'enable_ai_alerts',
      confirmed: false,
    })

    expect(result.ok).toBe(false)
    expect(result.applied).toBe(false)
    expect(result.message).toMatch(/requires explicit confirmation/i)
    expect(leagueFindUniqueMock).not.toHaveBeenCalled()
  })

  it('blocks subscription-gated unified actions for non-subscribers', async () => {
    resolveForUserMock.mockResolvedValueOnce({
      entitlement: {
        plans: [],
        status: 'none',
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      hasAccess: false,
      message: 'Upgrade to access this feature.',
    })
    leagueFindUniqueMock.mockResolvedValue({
      id: 'league-1',
      sport: 'NFL',
      userId: 'owner-1',
      tradeReviewHours: 48,
      playoffTeams: 6,
      user: { afCommissionerSub: false },
    })

    const { applyUnifiedCommissionerAction } = await import('../lib/ai-commissioner/UnifiedCommissionerSystem')

    const result = await applyUnifiedCommissionerAction({
      leagueId: 'league-1',
      userId: 'user-1',
      actionKey: 'run_commissioner_cycle',
      confirmed: true,
    })

    expect(result.ok).toBe(false)
    expect(result.applied).toBe(false)
    expect(result.message).toMatch(/subscription required/i)
    expect(runAICommissionerCycleMock).not.toHaveBeenCalled()
  })

  it('executes real cycle path for run_commissioner_cycle and returns cycle meta', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      id: 'league-1',
      sport: 'NFL',
      userId: 'owner-1',
      tradeReviewHours: 48,
      playoffTeams: 6,
      user: { afCommissionerSub: true },
    })
    runAICommissionerCycleMock.mockResolvedValue({
      createdAlerts: [{ alertId: 'a1' }, { alertId: 'a2' }],
      touchedAlerts: 4,
    })

    const { applyUnifiedCommissionerAction } = await import('../lib/ai-commissioner/UnifiedCommissionerSystem')

    const result = await applyUnifiedCommissionerAction({
      leagueId: 'league-1',
      userId: 'user-1',
      actionKey: 'run_commissioner_cycle',
      confirmed: true,
      payload: { sport: 'NFL', season: 2026 },
    })

    expect(runAICommissionerCycleMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      sport: 'NFL',
      season: 2026,
      source: 'unified_commissioner_api',
    })
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(true)
    expect(result.message).toMatch(/cycle completed/i)
    expect(result.meta).toMatchObject({ createdAlerts: 2, touchedAlerts: 4 })
    expect(appendAICommissionerActionLogMock).toHaveBeenCalled()
  })

  it('includes workflow and memory profile fields in unified assessment', async () => {
    const now = new Date('2026-04-13T00:00:00.000Z')

    leagueFindUniqueMock.mockResolvedValue({
      id: 'league-1',
      userId: 'owner-1',
      sport: 'NFL',
      season: 2026,
      leagueSize: 12,
      tradeReviewHours: 48,
      playoffStartWeek: 15,
      playoffTeams: 6,
      playoffWeeksPerRound: 1,
      timezone: 'America/Chicago',
      waiverType: 'rolling',
      leagueAiCommissionerAlerts: true,
      guillotineMode: false,
      survivorMode: false,
      bestBallMode: false,
      isDynasty: true,
      leagueType: 'dynasty',
      user: { afCommissionerSub: true },
      integritySettings: { collusionMonitoringEnabled: true, tankingMonitorEnabled: true },
    })

    analyzeLeagueGovernanceMock.mockResolvedValue({
      pendingWaiverClaims: 2,
      inactiveManagers: ['m1'],
      collusionSignals: [{ id: 'c1' }],
      tradeDisputes: [{ id: 'd1' }],
      scheduleContext: {
        lockReminderHours: 12,
        periodsUntilPlayoffs: 2,
      },
    })

    aiAlertCountMock.mockResolvedValueOnce(4).mockResolvedValueOnce(3)
    integrityFlagCountMock.mockResolvedValue(1)
    draftSessionFindUniqueMock.mockResolvedValue({ id: 'draft-1', commissionerAiManagers: null, status: 'active' })
    actionLogFindManyMock.mockResolvedValue([
      { actionType: 'RUN_CYCLE', createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
      { actionType: 'ALERT_RESOLVE', createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
    ])
    aiAlertFindManyMock.mockResolvedValue([
      { alertId: 'a1', headline: 'Trade dispute context', createdAt: new Date(now.getTime() - 60 * 60 * 1000) },
    ])

    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now.getTime())
    const { getUnifiedCommissionerAssessment } = await import('../lib/ai-commissioner/UnifiedCommissionerSystem')

    const assessment = await getUnifiedCommissionerAssessment({ leagueId: 'league-1' })

    expect(assessment.memoryProfile).toBeTruthy()
    expect(assessment.memoryProfile.recentActionCount).toBe(2)
    expect(assessment.memoryProfile.notes.length).toBeGreaterThan(0)
    expect(assessment.conflictResolution.workflow).toBeTruthy()
    expect(assessment.conflictResolution.workflow.stage).toBe('decision')
    expect(assessment.conflictResolution.workflow.recentOpenDisputes).toHaveLength(1)

    dateNowSpy.mockRestore()
  })

  describe('league rule actions go through the commissioner settings save', () => {
    beforeEach(() => {
      leagueFindUniqueMock.mockResolvedValue({ id: 'league-1', sport: 'NFL', userId: 'user-1', tradeReviewHours: 48, playoffTeams: 4 })
      settingsPatchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })

    it('tighten_trade_review_window saves the review window as a trades edit, never a bare update', async () => {
      const { applyUnifiedCommissionerAction } = await import('../lib/ai-commissioner/UnifiedCommissionerSystem')
      const result = await applyUnifiedCommissionerAction({
        leagueId: 'league-1', userId: 'user-1', actionKey: 'tighten_trade_review_window', confirmed: true, payload: { tradeReviewHours: 6 },
      })
      expect(result).toMatchObject({ ok: true, message: 'Trade review window set to 12h.' })
      expect(settingsPatchMock).toHaveBeenCalledWith('user-1', { leagueId: 'league-1', tradeReviewHours: 12 }, { section: 'trades' })
      expect(leagueUpdateMock).not.toHaveBeenCalled()
    })

    it('set_playoff_defaults saves teams and weeks per round as a playoffs edit', async () => {
      const { applyUnifiedCommissionerAction } = await import('../lib/ai-commissioner/UnifiedCommissionerSystem')
      await applyUnifiedCommissionerAction({
        leagueId: 'league-1', userId: 'user-1', actionKey: 'set_playoff_defaults', confirmed: true, payload: { playoffTeams: 6, playoffWeeksPerRound: 1 },
      })
      expect(settingsPatchMock).toHaveBeenCalledWith('user-1', { leagueId: 'league-1', playoffTeams: 6, playoffWeeksPerRound: 1 }, { section: 'playoffs' })
      expect(leagueUpdateMock).not.toHaveBeenCalled()
    })

    it('a refused save (a locked area, too many playoff teams) is the action result, and nothing is logged as applied', async () => {
      settingsPatchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'playoffTeams cannot exceed league size (4)' }), { status: 400 }))
      const { applyUnifiedCommissionerAction } = await import('../lib/ai-commissioner/UnifiedCommissionerSystem')
      const result = await applyUnifiedCommissionerAction({
        leagueId: 'league-1', userId: 'user-1', actionKey: 'set_playoff_defaults', confirmed: true, payload: { playoffTeams: 6 },
      })
      expect(result).toEqual({ ok: false, applied: false, message: 'playoffTeams cannot exceed league size (4)' })
      expect(appendAICommissionerActionLogMock).not.toHaveBeenCalled()
    })
  })
})
