/**
 * `League.settings.leagueChatThreadId` took ANY string on every writer, so a commissioner could point
 * their own league at a huddle or DM they happened to be in and then send "commissioner
 * announcements" into it (the broadcast route finds a thread's league through this link).
 *
 * A write now succeeds only when the value is the league's OWN chat room (`league:<leagueId>`), or
 * clears the link. The platform thread row records no league (no context/metadata column, and no
 * server path creates a league platform thread), so there is nothing trustworthy to validate a
 * thread id against — membership is not it, because the threads refused here are ones the
 * commissioner is genuinely in.
 *
 * Every writer that can put the key into `League.settings` runs for real against an in-memory
 * League table; only auth, notifications and side-effect modules are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type LeagueRow = {
  id: string
  userId: string
  leagueSize: number
  settings: Record<string, unknown> | null
  name: string
  teams: Array<{ claimedByUserId: string | null }>
  leagueSettings: null
}

const h = vi.hoisted(() => {
  const state = {
    sessionUserId: 'u-comm' as string | null,
    leagues: new Map<string, LeagueRow>(),
    /** Platform threads the commissioner genuinely belongs to — the ones that must be refused. */
    threads: [] as Array<{ id: string; threadType: string; memberIds: string[] }>,
    settingRequests: new Map<string, Record<string, unknown>>(),
  }
  const clone = <T,>(value: T): T => (value == null ? value : JSON.parse(JSON.stringify(value)))
  const prisma = {
    league: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => clone(state.leagues.get(where.id)) ?? null),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => clone(state.leagues.get(where.id)) ?? null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.leagues.get(where.id)
        if (!row) throw new Error('no such league')
        for (const [key, value] of Object.entries(data)) {
          ;(row as unknown as Record<string, unknown>)[key] = clone(value)
        }
        return clone(row)
      }),
    },
    platformChatThread: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.threads.find((t) => t.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => state.threads.find((t) => t.id === where.id) ?? null),
    },
    platformChatThreadMember: {
      findFirst: vi.fn(async ({ where }: { where: { threadId: string; userId: string } }) => {
        const thread = state.threads.find((t) => t.id === where.threadId)
        return thread?.memberIds.includes(where.userId) ? { id: `${where.threadId}:${where.userId}`, threadId: thread.id } : null
      }),
    },
    legacyTournament: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'T1' ? { creatorId: 'u-comm' } : null)),
    },
    legacyTournamentLeague: {
      findFirst: vi.fn(async ({ where }: { where: { tournamentId: string; leagueId: string } }) =>
        where.tournamentId === 'T1' && where.leagueId === 'L1' ? { id: 'tl-1' } : null,
      ),
    },
    legacyTournamentLeagueSettingRequest: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => clone(state.settingRequests.get(where.id)) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...(state.settingRequests.get(where.id) ?? {}), ...data }
        state.settingRequests.set(where.id, row)
        return row
      }),
    },
    leagueSettings: { upsert: vi.fn() },
    userProfile: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
  }
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => (h.state.sessionUserId ? { user: { id: h.state.sessionUserId } } : null)),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

// Commissioner of L1 is u-comm; nobody else commissions anything here.
const isCommissioner = (leagueId: string, userId: string) => leagueId === 'L1' && userId === 'u-comm'
vi.mock('@/lib/commissioner/permissions', () => ({
  assertCommissioner: vi.fn(async (leagueId: string, userId: string) => {
    if (!isCommissioner(leagueId, userId)) throw new Error('Forbidden')
  }),
}))
vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerRole: vi.fn(async (leagueId: string, userId: string) => {
    if (!isCommissioner(leagueId, userId)) throw new Response('Forbidden', { status: 403 })
  }),
}))
vi.mock('@/lib/adminAuth', () => ({ isAdminRole: () => false, isAdminEmailAllowed: () => false }))
vi.mock('@/lib/commissioner-settings', async () => {
  const validator = await vi.importActual<typeof import('@/lib/commissioner-settings/LeagueRuleValidator')>(
    '@/lib/commissioner-settings/LeagueRuleValidator',
  )
  return { getLeagueConfiguration: vi.fn(), validateCommissionerPatch: validator.validateCommissionerPatch }
})

// Side effects the writers fire after saving — irrelevant to what is saved.
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: async () => {} }), EVENT: { SETTINGS_CHANGED: 'settings_changed' } }))
vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({ invalidateLeagueDraftCaches: vi.fn() }))
vi.mock('@/lib/tournament/tournamentMiniCommissionerNotifications', () => ({ notifyUserPlatform: vi.fn(async () => {}) }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: vi.fn(async () => ({})) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn(async () => ({ hasAccess: false }))
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))

const COMMISSIONER = 'u-comm'
const LEAGUE = 'L1'
const DM = 'thread-dm-comm-and-manager'
const HUDDLE = 'thread-huddle-comm-and-friends'
const OWN_ROOM = `league:${LEAGUE}`

function jsonRequest(method: string, body: unknown) {
  return new Request('http://localhost/api/test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type Writer = { name: string; write: (value: unknown) => Promise<Response> }

const writers: Writer[] = [
  {
    // PATCH /api/commissioner/leagues/[leagueId]
    name: 'W1 commissioner league PATCH',
    write: async (value) => {
      const { PATCH } = await import('@/app/api/commissioner/leagues/[leagueId]/route')
      return PATCH(jsonRequest('PATCH', { leagueChatThreadId: value }) as never, { params: { leagueId: LEAGUE } })
    },
  },
  {
    // PATCH /api/commissioner/leagues/[leagueId]/settings -> CommissionerSettingsService
    name: 'W2 commissioner settings PATCH',
    write: async (value) => {
      const { PATCH } = await import('@/app/api/commissioner/leagues/[leagueId]/settings/route')
      return PATCH(jsonRequest('PATCH', { leagueChatThreadId: value }), { params: { leagueId: LEAGUE } })
    },
  },
  {
    // Reached by POST /api/league/settings and PATCH /api/leagues/[leagueId]/settings.
    name: 'W3 executeLeagueSettingsPatch settingsMerge',
    write: async (value) => {
      const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
      return executeLeagueSettingsPatch(COMMISSIONER, { leagueId: LEAGUE, settingsMerge: { leagueChatThreadId: value } })
    },
  },
  {
    // POST /api/tournament/[tournamentId]/league-settings-request/[requestId] { action: 'approve' }
    name: 'W4 tournament settings-request approve',
    write: async (value) => {
      h.state.settingRequests.set('req-1', {
        id: 'req-1',
        tournamentId: 'T1',
        leagueId: LEAGUE,
        requesterId: 'u-sub-commissioner',
        status: 'pending',
        proposedPatch: { leagueChatThreadId: value },
      })
      const { POST } = await import('@/app/api/tournament/[tournamentId]/league-settings-request/[requestId]/route')
      return POST(jsonRequest('POST', { action: 'approve' }) as never, {
        params: Promise.resolve({ tournamentId: 'T1', requestId: 'req-1' }),
      })
    },
  },
  {
    // PATCH /api/tournament/[tournamentId]/feeder-league/settings
    name: 'W5 tournament feeder-league PATCH',
    write: async (value) => {
      const { PATCH } = await import('@/app/api/tournament/[tournamentId]/feeder-league/settings/route')
      return PATCH(jsonRequest('PATCH', { leagueId: LEAGUE, changes: { leagueChatThreadId: value } }), {
        params: Promise.resolve({ tournamentId: 'T1' }),
      })
    },
  },
]

function seedLeague(settings: Record<string, unknown>) {
  h.state.leagues.set(LEAGUE, {
    id: LEAGUE,
    userId: COMMISSIONER,
    leagueSize: 10,
    settings,
    name: 'Commissioner League',
    teams: [],
    leagueSettings: null,
  })
}

const storedLink = () => h.state.leagues.get(LEAGUE)?.settings?.leagueChatThreadId

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  h.state.sessionUserId = COMMISSIONER
  h.state.settingRequests.clear()
  h.state.threads = [
    { id: DM, threadType: 'dm', memberIds: [COMMISSIONER, 'u-manager'] },
    { id: HUDDLE, threadType: 'group', memberIds: [COMMISSIONER, 'u-manager', 'u-friend'] },
  ]
  h.state.leagues.clear()
  seedLeague({ description: 'before' })
})

describe.each(writers)('$name', ({ write }) => {
  it('refuses a DM the commissioner belongs to, with a 400 and nothing saved', async () => {
    expect(h.state.threads.find((t) => t.id === DM)?.memberIds).toContain(COMMISSIONER)

    const res = await write(DM)

    expect(res.status).toBe(400)
    expect(String((await res.json()).error)).toMatch(/league's own chat/i)
    expect(h.prisma.league.update).not.toHaveBeenCalled()
    expect(storedLink()).toBeUndefined()
  })

  it('refuses a huddle the commissioner belongs to', async () => {
    expect(h.state.threads.find((t) => t.id === HUDDLE)?.memberIds).toContain(COMMISSIONER)

    const res = await write(HUDDLE)

    expect(res.status).toBe(400)
    expect(h.prisma.league.update).not.toHaveBeenCalled()
    expect(storedLink()).toBeUndefined()
  })

  it("refuses another league's room", async () => {
    const res = await write('league:L2')
    expect(res.status).toBe(400)
    expect(storedLink()).toBeUndefined()
  })

  it("accepts the league's own chat room and saves it", async () => {
    const res = await write(OWN_ROOM)
    expect(res.status).toBe(200)
    expect(storedLink()).toBe(OWN_ROOM)
    expect(h.state.leagues.get(LEAGUE)?.settings?.description).toBe('before')
  })

  it('still lets the link be cleared', async () => {
    seedLeague({ description: 'before', leagueChatThreadId: OWN_ROOM })
    const res = await write(null)
    expect(res.status).toBe(200)
    expect(storedLink()).toBeNull()
  })
})
