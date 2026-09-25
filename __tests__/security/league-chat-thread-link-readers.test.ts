/**
 * Every reader of `League.settings.leagueChatThreadId` goes through ONE validated accessor
 * (`leagueChatThreadIdFromSettings`, or `getLeagueChatThreadId` which reads the row and calls it).
 * A stored link that fails the rule — a DM or huddle the commissioner happens to be in — reads as
 * "no link", so no reader posts into it, pins in it, or hides messages in it.
 *
 * Production had 0 of 390 leagues with the key set, so this is defence in depth: the write side
 * already refuses a bad link. Each reader runs for real against an in-memory League row; only the
 * chat writers (spied), auth and unrelated side effects are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, unknown>,
  }
  const leagueRow = () => ({
    id: 'L1',
    userId: 'u-comm',
    name: 'Degenerates',
    sport: 'NFL',
    season: 2026,
    platform: 'native',
    settings: JSON.parse(JSON.stringify(state.settings)),
  })
  const alertRow = (over: Record<string, unknown> = {}) => ({
    alertId: 'alert-1',
    leagueId: 'L1',
    sport: 'NFL',
    alertType: 'inactive_manager',
    severity: 'medium',
    headline: 'Two lineups are empty',
    summary: 'Nudge them before kickoff.',
    relatedManagerIds: [],
    relatedTradeId: null,
    relatedMatchupId: null,
    status: 'open',
    snoozedUntil: null,
    createdAt: new Date('2026-09-25T12:00:00Z'),
    resolvedAt: null,
    ...over,
  })
  const prisma = {
    league: {
      findUnique: vi.fn(async () => leagueRow()),
      findFirst: vi.fn(async () => leagueRow()),
    },
    aiCommissionerConfig: {
      upsert: vi.fn(async () => ({
        configId: 'cfg-1',
        leagueId: 'L1',
        sport: 'NFL',
        remindersEnabled: true,
        disputeAnalysisEnabled: true,
        collusionMonitoringEnabled: true,
        voteSuggestionEnabled: true,
        inactivityMonitoringEnabled: true,
        commissionerNotificationMode: 'chat',
        updatedAt: new Date('2026-09-25T12:00:00Z'),
      })),
    },
    aiCommissionerAlert: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => alertRow()),
      update: vi.fn(async () => alertRow()),
    },
    aiCommissionerActionLog: { create: vi.fn(async () => ({})) },
    activityEvent: { create: vi.fn(async () => ({})) },
    roster: { findMany: vi.fn(async () => []) },
    leagueTeam: { findMany: vi.fn(async () => []) },
  }
  return {
    state,
    prisma,
    alertRow,
    createSystemMessage: vi.fn(async () => ({ id: 'sys-1' })),
    createPlatformThreadTypedMessage: vi.fn(async () => ({ id: 'typed-1' })),
    setMessageHiddenByMod: vi.fn(async () => true),
    createLeagueChatMessage: vi.fn(async () => ({ id: 'league-msg-1' })),
    // The AI Commissioner's notices no longer read the link at all: they post into the league's own
    // chat as Chimmy (lib/league-chat/chimmyMoments.ts). Spied, so "went to league chat" is visible.
    postChimmyMoment: vi.fn(async () => ({ posted: true, messageId: 'chimmy-1' })),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma, default: h.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-comm' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => ({ league: { id: 'L1' } })) }))
vi.mock('@/lib/commissioner/broadcastAccess', () => ({ broadcastRefusal: vi.fn(async () => null) }))
vi.mock('@/lib/platform/chat-service', () => ({
  createSystemMessage: h.createSystemMessage,
  createPlatformThreadTypedMessage: h.createPlatformThreadTypedMessage,
  setMessageHiddenByMod: h.setMessageHiddenByMod,
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: h.createLeagueChatMessage }))
vi.mock('@/lib/league-chat/chimmyMoments', () => ({ postChimmyMoment: h.postChimmyMoment, chimmyDayKey: () => '2026-09-25' }))
vi.mock('@/lib/draft-notifications/DraftNotificationService', () => ({ getLeagueMemberAppUserIds: vi.fn(async () => []) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async () => {}) }))
// The AI commissioner's analysis is not what is under test — one alert comes out of it, every time.
vi.mock('@/lib/ai-commissioner/LeagueGovernanceAnalyzer', () => ({ analyzeLeagueGovernance: vi.fn(async () => ({})) }))
vi.mock('@/lib/ai-commissioner/CommissionerAlertGenerator', () => ({
  generateCommissionerAlerts: vi.fn(() => [
    { alertType: 'inactive_manager', severity: 'medium', headline: 'Two lineups are empty', summary: 'Nudge them.' },
  ]),
}))
vi.mock('@/lib/ai-commissioner/LeagueInsightGenerator', () => ({ generateLeagueInsights: vi.fn() }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: vi.fn() }))
vi.mock('@/lib/ai-result-cache', () => ({ buildAiCacheKey: vi.fn(), readAiResultCache: vi.fn(), writeAiResultCache: vi.fn() }))
// The alerts route imports the index; the service itself is exercised directly further down.
vi.mock('@/lib/ai-commissioner', () => ({
  appendAICommissionerActionLog: vi.fn(async () => {}),
  toAlertView: (a: unknown) => a,
  updateAICommissionerAlertStatus: vi.fn(),
}))
// Waiver hooks' unrelated side effects.
vi.mock('@/lib/trade-engine/caching', () => ({ handleInvalidationTrigger: vi.fn() }))
vi.mock('@/lib/commentary-engine', () => ({ onWaiverReaction: vi.fn(async () => {}) }))
vi.mock('@/lib/player-trend', () => ({ recordTrendSignalsAndUpdate: vi.fn(async () => {}) }))

const DM = 'thread-dm-comm-and-manager'
const HUDDLE = 'thread-huddle-comm-and-friends'
const OWN_ROOM = 'league:L1'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Every platform-thread writer the readers could reach, as the ids they were handed. */
function platformThreadsWritten(): string[] {
  return [
    ...h.createSystemMessage.mock.calls.map((c) => String((c as unknown[])[0])),
    ...h.createPlatformThreadTypedMessage.mock.calls.map((c) => String((c as unknown[])[1])),
    ...h.setMessageHiddenByMod.mock.calls.map((c) => String((c as unknown[])[0])),
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.settings = {}
})

describe('leagueChatThreadIdFromSettings — the one read accessor', () => {
  it.each([
    ['a DM', { leagueChatThreadId: DM }],
    ['a huddle', { leagueChatThreadId: HUDDLE }],
    ["another league's room", { leagueChatThreadId: 'league:L2' }],
    ['no link', {}],
    ['no settings', null],
    ['a non-string link', { leagueChatThreadId: 42 }],
  ])('reads %s as no link', async (_label, settings) => {
    const { leagueChatThreadIdFromSettings } = await import('@/lib/league/leagueChatThreadLink')
    expect(leagueChatThreadIdFromSettings('L1', settings)).toBeNull()
  })

  it("returns the league's own room", async () => {
    const { leagueChatThreadIdFromSettings } = await import('@/lib/league/leagueChatThreadLink')
    expect(leagueChatThreadIdFromSettings('L1', { leagueChatThreadId: OWN_ROOM })).toBe(OWN_ROOM)
  })
})

describe('POST /api/commissioner/broadcast — via getLeagueChatThreadId', () => {
  async function announce() {
    const { POST } = await import('@/app/api/commissioner/broadcast/route')
    return POST(jsonRequest({ leagueIds: ['L1'], message: 'Deadline is Sunday' }) as never)
  }

  it.each([DM, HUDDLE])('a stored bad link (%s) cannot divert the announcement out of league chat', async (bad) => {
    h.state.settings = { leagueChatThreadId: bad }
    const res = await announce()
    expect(res.status).toBe(200)
    expect(platformThreadsWritten()).toEqual([])
    expect(h.createLeagueChatMessage).toHaveBeenCalledWith('L1', 'u-comm', '@everyone Deadline is Sunday', { type: 'broadcast' })
  })
})

describe('POST /api/commissioner/leagues/[leagueId]/chat — broadcast, pin, remove_message', () => {
  async function act(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/chat/route')
    return POST(jsonRequest(body) as never, { params: { leagueId: 'L1' } })
  }

  it.each([
    ['broadcast', { action: 'broadcast', message: 'Deadline is Sunday' }],
    ['pin', { action: 'pin', messageId: 'm-1' }],
    ['remove_message', { action: 'remove_message', messageId: 'm-1' }],
  ])('%s treats a stored DM link as no link and touches no thread', async (_label, body) => {
    h.state.settings = { leagueChatThreadId: DM }
    const res = await act(body)
    expect(res.status).toBe(400)
    expect((await res.json()).status).toBe('not_linked')
    expect(platformThreadsWritten()).toEqual([])
  })

  it("still hands the league's own room through (positive control)", async () => {
    h.state.settings = { leagueChatThreadId: OWN_ROOM }
    await act({ action: 'remove_message', messageId: 'm-1' })
    expect(h.setMessageHiddenByMod).toHaveBeenCalledWith(OWN_ROOM, 'm-1', true)
  })
})

/*
 * The AI Commissioner's two chat paths no longer READ the link: both post into the league's own chat
 * as Chimmy (lib/league-chat/chimmyMoments.ts), so a stored DM or huddle link has nothing to divert.
 * These keep the property this file guards — nothing reaches a DM or huddle — and show where it goes.
 */
describe('AICommissionerService.runAICommissionerCycle — chat notices', () => {
  it('does not post its notice into a stored DM link — it goes to league chat as Chimmy', async () => {
    h.state.settings = { leagueChatThreadId: DM }
    const { runAICommissionerCycle } = await import('@/lib/ai-commissioner/AICommissionerService')
    const out = await runAICommissionerCycle({ leagueId: 'L1' })
    expect(out.createdAlerts).toHaveLength(1)
    expect(platformThreadsWritten()).toEqual([])
    expect(h.postChimmyMoment).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', kind: 'commissioner_alerts' }))
  })

  it('needs no link at all to reach league chat (positive control)', async () => {
    h.state.settings = {}
    const { runAICommissionerCycle } = await import('@/lib/ai-commissioner/AICommissionerService')
    await runAICommissionerCycle({ leagueId: 'L1' })
    expect(h.postChimmyMoment).toHaveBeenCalledTimes(1)
    expect(platformThreadsWritten()).toEqual([])
  })
})

describe('PATCH /api/leagues/[leagueId]/ai-commissioner/alerts/[alertId] — send_notice', () => {
  async function sendNotice() {
    h.prisma.aiCommissionerAlert.findFirst.mockResolvedValueOnce(h.alertRow() as never)
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/ai-commissioner/alerts/[alertId]/route')
    return PATCH(jsonRequest({ action: 'send_notice' }), {
      params: Promise.resolve({ leagueId: 'L1', alertId: 'alert-1' }),
    })
  }

  it('never sends into a stored DM link — the notice goes to league chat as Chimmy', async () => {
    h.state.settings = { leagueChatThreadId: DM }
    const res = await sendNotice()
    expect(res.status).toBe(200)
    expect(platformThreadsWritten()).toEqual([])
    expect(h.postChimmyMoment).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', kind: 'commissioner_notice' }))
  })

  it('needs no link at all to reach league chat (positive control)', async () => {
    h.state.settings = {}
    const res = await sendNotice()
    expect(res.status).toBe(200)
    expect(h.postChimmyMoment).toHaveBeenCalledTimes(1)
  })
})

describe('onWaiverRunComplete — the waiver bot line', () => {
  const results = [{ success: true, claimId: 'c1', rosterId: 'r1', message: 'Won' }] as never

  it('does not post into a stored huddle link', async () => {
    h.state.settings = { leagueChatThreadId: HUDDLE }
    const { onWaiverRunComplete } = await import('@/lib/waiver-wire/run-hooks')
    await onWaiverRunComplete('L1', results)
    expect(platformThreadsWritten()).toEqual([])
  })

  it("posts to the league's own room when that is the link (positive control)", async () => {
    h.state.settings = { leagueChatThreadId: OWN_ROOM }
    const { onWaiverRunComplete } = await import('@/lib/waiver-wire/run-hooks')
    await onWaiverRunComplete('L1', results)
    expect(h.createSystemMessage).toHaveBeenCalledWith(OWN_ROOM, 'waiver_bot', expect.any(String))
  })
})
