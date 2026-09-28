// @vitest-environment node
/**
 * The AI Commissioner's notices post into the league's OWN chat as Chimmy — no "AI" label, no platform
 * thread link — through the REAL `postChimmyMoment` and the REAL LeagueChatMessageService over an
 * in-memory Prisma.
 *
 *   - "Send notice" (a commissioner pressed it): skips the daily cap, once per alert per day, and says
 *     plainly when it did not post — it used to answer 200 over a failed post.
 *   - The automatic cycle's summary (notices set to chat): Chimmy on its own, so it IS capped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  rows: [] as Array<Record<string, unknown>>,
  settings: null as unknown,
  mode: 'chat',
  createFail: false,
  systemMessage: vi.fn(async () => ({ id: 'sys-1' })),
  actionLog: vi.fn(async () => ({})),
}))

const alertRow = (over: Record<string, unknown> = {}) => ({
  alertId: 'alert-1',
  leagueId: 'L1',
  sport: 'NFL',
  alertType: 'playoff_deadline',
  severity: 'medium',
  headline: '[AI Commissioner] Playoff deadline is approaching',
  summary: 'Only 2 scoring period(s) until playoffs. AI suggests a lock reminder.',
  relatedManagerIds: [],
  relatedTradeId: null,
  relatedMatchupId: null,
  status: 'open',
  snoozedUntil: null,
  createdAt: new Date('2026-09-25T12:00:00Z'),
  resolvedAt: null,
  ...over,
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: async () => ({ id: 'L1', userId: 'commish', sport: 'NFL', season: 2026, settings: h.settings }),
    },
    sportsDataCache: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: Array<{ cacheKey: string; data: unknown; expiresAt: Date }> }) => {
        let count = 0
        for (const r of data) {
          if (h.cache.has(r.cacheKey)) continue
          h.cache.set(r.cacheKey, { data: r.data, expiresAt: r.expiresAt })
          count += 1
        }
        return { count }
      },
    },
    leagueChatMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (h.createFail) throw Object.assign(new Error('db down'), { name: 'PrismaClientUnknownRequestError' })
        const row = {
          id: `m${h.rows.length + 1}`,
          ...data,
          createdAt: new Date('2026-09-25T18:00:00Z'),
          user: { id: data.userId, username: 'pat', displayName: 'Pat Commissioner', avatarUrl: null, profile: null },
        }
        h.rows.push(row)
        return row
      },
    },
    aiCommissionerAlert: {
      findFirst: async ({ where }: { where: { alertId?: string } }) => (where.alertId ? alertRow() : null),
      create: async () => alertRow({ alertId: 'alert-new', headline: 'Two lineups are empty', summary: 'Nudge them.' }),
      update: async () => alertRow(),
    },
    aiCommissionerConfig: {
      upsert: async () => ({
        configId: 'cfg-1',
        leagueId: 'L1',
        sport: 'NFL',
        remindersEnabled: true,
        disputeAnalysisEnabled: true,
        collusionMonitoringEnabled: true,
        voteSuggestionEnabled: true,
        inactivityMonitoringEnabled: true,
        commissionerNotificationMode: h.mode,
        updatedAt: new Date('2026-09-25T12:00:00Z'),
      }),
    },
    aiCommissionerActionLog: { create: async () => ({}) },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'commish' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: async () => ({ league: { id: 'L1' } }) }))
// The old dead path: nothing may be written into a platform thread any more.
vi.mock('@/lib/platform/chat-service', () => ({ createSystemMessage: h.systemMessage }))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: async () => ({ synced: false }) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/ai-commissioner/LeagueGovernanceAnalyzer', () => ({ analyzeLeagueGovernance: vi.fn(async () => ({})) }))
vi.mock('@/lib/ai-commissioner/CommissionerAlertGenerator', () => ({
  generateCommissionerAlerts: vi.fn(() => [
    { alertType: 'inactive_manager', severity: 'medium', headline: 'Two lineups are empty', summary: 'Nudge them.' },
  ]),
}))
vi.mock('@/lib/ai-commissioner/LeagueInsightGenerator', () => ({ generateLeagueInsights: vi.fn() }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: vi.fn() }))
vi.mock('@/lib/ai-result-cache', () => ({ buildAiCacheKey: vi.fn(), readAiResultCache: vi.fn(), writeAiResultCache: vi.fn() }))
vi.mock('@/lib/ai-commissioner', () => ({
  appendAICommissionerActionLog: h.actionLog,
  toAlertView: (a: unknown) => a,
  updateAICommissionerAlertStatus: vi.fn(),
}))

import { CHIMMY_DAILY_CAP, chimmyDayKey, chimmyMomentSlotCacheKey } from '@/lib/league-chat/chimmyMoments'
import { commissionerAlertsText, commissionerNoticeText, inChimmysVoice } from '@/lib/league-chat/chimmyCommissionerNotices'

async function sendNotice() {
  const { PATCH } = await import('@/app/api/leagues/[leagueId]/ai-commissioner/alerts/[alertId]/route')
  const req = new Request('http://localhost/api/leagues/L1/ai-commissioner/alerts/alert-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'send_notice' }),
  })
  return PATCH(req, { params: Promise.resolve({ leagueId: 'L1', alertId: 'alert-1' }) })
}

function fillTodaysSlots() {
  const day = chimmyDayKey(new Date())
  for (let s = 1; s <= CHIMMY_DAILY_CAP; s++) {
    h.cache.set(chimmyMomentSlotCacheKey('L1', day, s), { data: {}, expiresAt: new Date(Date.now() + 86_400_000) })
  }
}

beforeEach(() => {
  h.cache.clear()
  h.rows = []
  h.settings = null
  h.mode = 'chat'
  h.createFail = false
  h.systemMessage.mockClear()
  h.actionLog.mockClear()
})

describe('"Send notice" posts into league chat as Chimmy', () => {
  it('lands in the league’s own chat, as Chimmy, with no AI label and no thread link needed', async () => {
    const res = await sendNotice()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'sent', messageId: 'm1' })

    expect(h.systemMessage).not.toHaveBeenCalled()
    expect(h.rows).toHaveLength(1)
    const row = h.rows[0]!
    expect(row.leagueId).toBe('L1')
    expect(row.userId).toBe('commish')
    expect(row.metadata).toMatchObject({ chimmy: true, chimmyMoment: { v: 1, kind: 'commissioner_notice' } })
    expect(row.message).toBe(
      "From the commissioner's desk: Playoff deadline is approaching. Only 2 scoring period(s) until playoffs. Chimmy suggests a lock reminder.",
    )
    expect(String(row.message)).not.toMatch(/\bAI\b/)
    expect(h.actionLog).toHaveBeenCalledTimes(1)
  })

  it('skips the daily cap — a commissioner asked for it', async () => {
    fillTodaysSlots()
    expect((await sendNotice()).status).toBe(200)
    expect(h.rows).toHaveLength(1)
  })

  it('posts once per alert per day, and says so on a second press', async () => {
    await sendNotice()
    const again = await sendNotice()
    expect(again.status).toBe(409)
    expect((await again.json()).error).toMatch(/already in league chat/)
    expect(h.rows).toHaveLength(1)
  })

  it('respects "Chimmy speaks up" being off, and tells the commissioner how to turn it on', async () => {
    h.settings = { chimmySpeaksUp: false }
    const res = await sendNotice()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Chimmy speaks up in league chat/)
    expect(h.rows).toHaveLength(0)
    expect(h.actionLog).not.toHaveBeenCalled()
  })

  it('🛑 a failed post is a failure, not "sent"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    h.createFail = true
    const res = await sendNotice()
    expect(res.status).toBe(502)
    expect((await res.json()).status).toBe('failed')
    expect(h.actionLog).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('the automatic cycle’s summary posts as Chimmy, inside the cap', () => {
  it('with notices set to chat, posts the summary into league chat as Chimmy', async () => {
    const { runAICommissionerCycle } = await import('@/lib/ai-commissioner/AICommissionerService')
    await runAICommissionerCycle({ leagueId: 'L1' })
    expect(h.systemMessage).not.toHaveBeenCalled()
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]!.metadata).toMatchObject({ chimmy: true, chimmyMoment: { v: 1, kind: 'commissioner_alerts' } })
    expect(h.rows[0]!.message).toBe('The commissioner has one new thing to look at: Two lineups are empty.')
  })

  it('counts against the daily cap — nobody pressed a button for it', async () => {
    fillTodaysSlots()
    const { runAICommissionerCycle } = await import('@/lib/ai-commissioner/AICommissionerService')
    await runAICommissionerCycle({ leagueId: 'L1' })
    expect(h.rows).toHaveLength(0)
  })

  it('stays out of league chat when notices are in-app only', async () => {
    h.mode = 'in_app'
    const { runAICommissionerCycle } = await import('@/lib/ai-commissioner/AICommissionerService')
    await runAICommissionerCycle({ leagueId: 'L1' })
    expect(h.rows).toHaveLength(0)
  })
})

describe('the words', () => {
  it('drop the "[AI Commissioner]" tag and never say a bare "AI"', () => {
    expect(inChimmysVoice('[AI Commissioner] Trade review recommended')).toBe('Trade review recommended')
    expect(inChimmysVoice('The AI Commissioner flagged it; AI thinks so')).toBe('Chimmy flagged it; Chimmy thinks so')
    expect(inChimmysVoice('FAIR and MAIN stay as they are')).toBe('FAIR and MAIN stay as they are')
  })

  it('say how many and name the top one', () => {
    expect(commissionerAlertsText([{ headline: 'A' }, { headline: 'B' }])).toBe(
      'The commissioner has 2 new things to look at. Top of the list: A.',
    )
    expect(commissionerNoticeText({ headline: 'Waiver queue requires commissioner attention', summary: '3 claims pending' })).toBe(
      "From the commissioner's desk: Waiver queue requires commissioner attention. 3 claims pending.",
    )
  })
})
