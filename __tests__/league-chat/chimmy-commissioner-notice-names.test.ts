// @vitest-environment node
/**
 * A commissioner notice in LEAGUE chat says names, never internal ids.
 *
 * The governance generators store "Manager 7 has shown no recent activity for 12 days." and
 * "Trade 1123581321345589 has a value delta near 63%…" — the commissioner's record, which keeps its
 * ids. What the league reads names the team instead: team or manager display name, then username,
 * then "a manager". Never an email.
 *
 * "Send notice" runs through the REAL route, the REAL name resolver and the REAL postChimmyMoment over
 * an in-memory Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  chat: [] as Array<Record<string, unknown>>,
  alert: null as null | Record<string, unknown>,
  teams: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
  trades: [] as Array<Record<string, unknown>>,
  alertWrites: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => ({ id: 'L1', userId: 'commish', settings: null }) },
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
        const row = { id: `m${h.chat.length + 1}`, ...data, createdAt: new Date(), user: { id: data.userId, username: 'pat', displayName: 'Pat', avatarUrl: null, profile: null } }
        h.chat.push(row)
        return row
      },
    },
    aiCommissionerAlert: {
      findFirst: async () => h.alert,
      update: h.alertWrites,
      updateMany: h.alertWrites,
    },
    leagueTeam: {
      findMany: async ({ where }: { where: { leagueId: string; OR: Array<{ externalId?: { in: string[] }; ownerName?: { in: string[] } }> } }) => {
        const ids = where.OR.flatMap((c) => c.externalId?.in ?? c.ownerName?.in ?? [])
        return h.teams.filter((t) => t.leagueId === where.leagueId && (ids.includes(t.externalId as string) || ids.includes(t.ownerName as string)))
      },
    },
    appUser: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => h.users.filter((u) => where.id.in.includes(u.id as string)),
    },
    leagueTrade: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => h.trades.filter((t) => where.id.in.includes(t.id as string)),
    },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'commish' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: async () => ({ league: { id: 'L1' } }) }))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: async () => ({ synced: false }) }))
vi.mock('@/lib/ai-commissioner', () => ({
  appendAICommissionerActionLog: vi.fn(async () => ({})),
  toAlertView: (a: Record<string, unknown>) => ({ ...a, relatedManagerIds: Array.isArray(a.relatedManagerIds) ? a.relatedManagerIds.map(String) : [] }),
  updateAICommissionerAlertStatus: vi.fn(),
}))

import { commissionerNoticeText, namesInNoticeText } from '@/lib/league-chat/chimmyCommissionerNotices'

const TX = '1123581321345589'
const TRADE_ROW = 'ckzq1x2y3z4a5b6c7d8e9f0g1'

const alertRow = (over: Record<string, unknown>) => ({
  alertId: 'alert-1',
  leagueId: 'L1',
  sport: 'NFL',
  alertType: 'INACTIVE_MANAGER_WARNING',
  severity: 'medium',
  headline: 'Inactive manager risk detected',
  summary: 'Manager 7 has shown no recent activity for 12 days.',
  relatedManagerIds: ['7'],
  relatedTradeId: null,
  relatedMatchupId: null,
  status: 'open',
  ...over,
})

async function sendNotice() {
  const { PATCH } = await import('@/app/api/leagues/[leagueId]/ai-commissioner/alerts/[alertId]/route')
  const req = new Request('http://localhost/api/leagues/L1/ai-commissioner/alerts/alert-1', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'send_notice' }),
  })
  return PATCH(req, { params: Promise.resolve({ leagueId: 'L1', alertId: 'alert-1' }) })
}

const posted = () => h.chat[0]!.message as string

beforeEach(() => {
  h.cache.clear()
  h.chat = []
  h.alertWrites.mockClear()
  h.teams = [
    { leagueId: 'L1', externalId: '7', ownerName: 'sam_the_man', teamName: "Sam's Squad", claimedByUserId: 'u7' },
    { leagueId: 'L1', externalId: '4', ownerName: 'riley@example.com', teamName: '', claimedByUserId: 'u4' },
    { leagueId: 'L1', externalId: '9', ownerName: 'casey@example.com', teamName: '', claimedByUserId: null },
  ]
  h.users = [
    { id: 'u7', displayName: 'Sam', username: 'sam7' },
    { id: 'u4', displayName: null, username: 'riley_r' },
  ]
  h.trades = [{ id: TRADE_ROW, transactionId: TX, partnerRosterId: 4, partnerName: 'riley@example.com' }]
})

describe('Send notice posts names, never ids', () => {
  it('a manager id becomes the team name', async () => {
    h.alert = alertRow({})
    const res = await sendNotice()
    expect(res.status).toBe(200)
    expect(posted()).toBe("From the commissioner's desk: Inactive manager risk detected. Sam's Squad has shown no recent activity for 12 days.")
    expect(posted()).not.toMatch(/Manager 7|\b7 has/)
  })

  it('a trade id becomes "a trade with <partner>", and an email falls through to the username', async () => {
    h.alert = alertRow({
      alertType: 'DISPUTE_CONTEXT',
      headline: 'Trade dispute context ready',
      summary: `Trade ${TX} has a value delta near 63% and should be reviewed for fairness.`,
      relatedManagerIds: ['4'],
      relatedTradeId: TRADE_ROW,
    })
    await sendNotice()
    expect(posted()).toBe(
      "From the commissioner's desk: Trade dispute context ready. A trade with riley_r has a value delta near 63% and should be reviewed for fairness.",
    )
    expect(posted()).not.toContain(TX)
    expect(posted()).not.toContain('@')
  })

  it('the internal row id of a flagged trade never reaches the league', async () => {
    h.alert = alertRow({
      alertType: 'TRADE_REVIEW_FLAG',
      headline: 'Trade review recommended',
      summary: `Flagging trade ${TRADE_ROW} for commissioner review due to value imbalance signals.`,
      relatedManagerIds: ['4'],
      relatedTradeId: TRADE_ROW,
    })
    await sendNotice()
    expect(posted()).toContain('Flagging a trade with riley_r for commissioner review')
    expect(posted()).not.toContain(TRADE_ROW)
  })

  it('nobody nameable is "a manager" — never the email on file', async () => {
    h.alert = alertRow({ summary: 'Manager 9 has shown no recent activity for 30 days.', relatedManagerIds: ['9'] })
    await sendNotice()
    expect(posted()).toContain('A manager has shown no recent activity for 30 days.')
    expect(posted()).not.toMatch(/casey|@|Manager 9/)
  })

  it('keeps the ids in the stored alert: the notice never rewrites it', async () => {
    const stored = alertRow({})
    h.alert = stored
    const res = await sendNotice()
    const body = (await res.json()) as { alert: { summary: string; relatedManagerIds: string[] } }
    expect(h.alertWrites).not.toHaveBeenCalled()
    expect(stored.summary).toBe('Manager 7 has shown no recent activity for 12 days.')
    expect(body.alert.summary).toBe('Manager 7 has shown no recent activity for 12 days.')
    expect(body.alert.relatedManagerIds).toEqual(['7'])
  })
})

describe('the renderer (pure) scrubs ids no generator told it about', () => {
  it('UUIDs, cuids, provider team keys, long digit runs and emails', () => {
    const out = namesInNoticeText(
      'Contact sam@example.com: manager 9f1c2d3e-1111-2222-3333-444455556666 and Manager 461.l.12345.t.7 traded (trade ckzq1x2y3z4a5b6c7d8e9f0g1).',
      { headline: '' },
    )
    expect(out).toBe('Contact a manager: a manager and A manager traded (a recent trade).')
  })

  it('leaves ordinary numbers alone — counts of days and percentages are the point of the notice', () => {
    expect(
      commissionerNoticeText({ headline: 'Playoff deadline is approaching', summary: 'Only 2 scoring period(s) until playoffs.' }),
    ).toBe("From the commissioner's desk: Playoff deadline is approaching. Only 2 scoring period(s) until playoffs.")
    expect(
      namesInNoticeText('Trade value imbalance detected (63.5%). Manual review recommended.', { headline: '', relatedManagerIds: ['3'] }),
    ).toBe('Trade value imbalance detected (63.5%). Manual review recommended.')
  })
})
