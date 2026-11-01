/**
 * GET/POST /api/leagues/:leagueId/rules-explainer (served by the [section] dispatcher), and the
 * seen-state store it writes (UserProfile.corePreferences.leagueRulesSeen — no migration).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: { user: { id: 'member' } } as { user?: { id?: string } } | null,
  membership: { ok: true, access: {} } as { ok: boolean; status?: number; access?: unknown },
  role: 'member' as string | null,
  league: null as Record<string, unknown> | null,
  seen: { rulesSeenAt: null, lastSeenSettingsEventId: null, lastSeenSettingsEventAt: null } as Record<string, string | null>,
  events: [] as unknown[],
  prisma: {
    league: { findUnique: vi.fn() },
    leagueEvent: { findFirst: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn(async () => m.membership) }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn(async () => m.role) }))
vi.mock('@/lib/league-rules-explainer/load', async () => {
  const snap = await vi.importActual<typeof import('@/lib/league-rules-explainer/snapshot')>('@/lib/league-rules-explainer/snapshot')
  return {
    loadRuleSnapshot: vi.fn(async (_id: string, row: never) => snap.ruleSnapshotFromLeague(row)),
    loadSettingsChangeEvents: vi.fn(async () => m.events),
  }
})

import { GET, POST } from '@/app/api/leagues/[leagueId]/rules-explainer/handler'
import { getLeagueRulesSeen, setLeagueRulesSeen } from '@/lib/league-rules-explainer/seenStore'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const req = (body?: unknown) =>
  new Request('http://x/api/leagues/L1/rules-explainer', body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const NFL = {
  id: 'L1',
  platform: 'allfantasy',
  sport: 'NFL',
  leagueType: 'redraft',
  leagueSize: 12,
  tradeDeadlineWeek: 13,
  playoffTeams: 6,
  playoffStartWeek: 15,
  waiverType: 'faab',
  waiverBudget: 100,
  settings: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { user: { id: 'member' } }
  m.membership = { ok: true, access: {} }
  m.role = 'member'
  m.league = { ...NFL }
  m.events = []
  m.seen = { rulesSeenAt: null, lastSeenSettingsEventId: null, lastSeenSettingsEventAt: null }
  m.prisma.league.findUnique.mockImplementation(async () => m.league)
  m.prisma.$queryRaw.mockImplementation(async () => [{ seen: m.seen }])
  m.prisma.$executeRaw.mockResolvedValue(1)
})

describe('GET', () => {
  it('refuses a signed-out viewer and a non-member', async () => {
    m.session = null
    expect((await GET(req(), ctx)).status).toBe(401)
    m.session = { user: { id: 'stranger' } }
    m.membership = { ok: false, status: 403 }
    expect((await GET(req(), ctx)).status).toBe(403)
    expect(m.prisma.league.findUnique).not.toHaveBeenCalled()
  })

  it('reports a league it cannot explain as unsupported (an unhosted sport, an unknown format)', async () => {
    for (const league of [{ ...NFL, sport: 'CRICKET' }, { ...NFL, leagueType: 'mystery' }, { ...NFL, platform: 'sleeper', sport: 'CRICKET' }]) {
      m.league = league
      expect(await (await GET(req(), ctx)).json()).toEqual({ supported: false })
    }
  })

  it('serves an imported league from what its import carries, never its schema-default columns, with no change cards', async () => {
    m.league = { ...NFL, platform: 'sleeper', settings: { roster_positions: ['QB', 'RB', 'RB', 'WR', 'BN'], playoff_teams: 4 } }
    m.events = [{ id: 'e9', createdAt: '2026-10-02T00:00:00.000Z', actorUserId: 'commish', changes: [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }] }]
    const body = await (await GET(req(), ctx)).json()
    expect(body.supported).toBe(true)
    expect(body.sections.map((s: { id: string }) => s.id)).toEqual(['overview', 'scoring', 'roster', 'playoffs'])
    expect(body.pendingChanges).toEqual([])
    expect(body.history).toEqual([])
    const { loadRuleSnapshot, loadSettingsChangeEvents } = await import('@/lib/league-rules-explainer/load')
    expect(loadRuleSnapshot).not.toHaveBeenCalled()
    expect(loadSettingsChangeEvents).not.toHaveBeenCalled()
  })

  it('a native dynasty league gets its dynasty rules', async () => {
    m.league = { ...NFL, leagueType: 'dynasty', draftPickTrading: true, settings: { pick_trade_deadline: { mode: 'open' } } }
    const body = await (await GET(req(), ctx)).json()
    expect(body.format).toBe('dynasty')
    expect(body.sections.map((s: { id: string }) => s.id)).toEqual(['overview', 'scoring', 'lineups', 'dynasty', 'playoffs', 'trades', 'waivers'])
  })

  it('a member who has not seen the rules gets the popup', async () => {
    const body = await (await GET(req(), ctx)).json()
    expect(body.supported).toBe(true)
    expect(body.showRulesPopup).toBe(true)
    expect(body.isCommissioner).toBe(false)
    expect(body.sections.map((s: { id: string }) => s.id)).toEqual(['overview', 'scoring', 'lineups', 'playoffs', 'trades', 'waivers'])
  })

  it('a member who has seen them gets a card for a newer commissioner change, unless broadcasts are off', async () => {
    m.seen = { rulesSeenAt: '2026-10-01T00:00:00.000Z', lastSeenSettingsEventId: 'e1', lastSeenSettingsEventAt: '2026-10-01T00:00:00.000Z' }
    m.events = [{ id: 'e2', createdAt: '2026-10-02T00:00:00.000Z', actorUserId: 'commish', changes: [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }] }]
    let body = await (await GET(req(), ctx)).json()
    expect(body.showRulesPopup).toBe(false)
    expect(body.pendingChanges).toHaveLength(1)
    m.league = { ...NFL, settings: { leagueNotificationPrefs: { commissionerBroadcasts: false } } }
    body = await (await GET(req(), ctx)).json()
    expect(body.pendingChanges).toHaveLength(0)
    expect(body.history).toHaveLength(1)
  })
})

describe('POST', () => {
  it('rejects an unknown kind', async () => {
    expect((await POST(req({ kind: 'everything' }), ctx)).status).toBe(400)
    expect(m.prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('kind=rules records rulesSeenAt and the newest settings event', async () => {
    m.prisma.leagueEvent.findFirst.mockResolvedValue({ id: 'e7', createdAt: new Date('2026-10-05T00:00:00.000Z') })
    const res = await POST(req({ kind: 'rules' }), ctx)
    expect(res.status).toBe(200)
    const { seen } = await res.json()
    expect(seen.rulesSeenAt).toEqual(expect.any(String))
    expect(seen.lastSeenSettingsEventId).toBe('e7')
    expect(m.prisma.leagueEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', eventType: 'settings_changed' } }))
    expect(m.prisma.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('kind=changes only accepts this league’s settings event', async () => {
    m.prisma.leagueEvent.findFirst.mockResolvedValue(null)
    expect((await POST(req({ kind: 'changes', eventId: 'other-league-event' }), ctx)).status).toBe(404)
    expect(m.prisma.leagueEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'other-league-event', leagueId: 'L1', eventType: 'settings_changed' } }),
    )
    expect(m.prisma.$executeRaw).not.toHaveBeenCalled()
    expect((await POST(req({ kind: 'changes' }), ctx)).status).toBe(400)
  })
})

describe('seen store', () => {
  it('merges ONE league entry into corePreferences.leagueRulesSeen atomically, in SQL', async () => {
    await setLeagueRulesSeen('u1', 'L1', { rulesSeenAt: 'a', lastSeenSettingsEventId: 'e', lastSeenSettingsEventAt: 'b' })
    const [strings, ...values] = m.prisma.$executeRaw.mock.calls[0]! as [TemplateStringsArray, ...unknown[]]
    const sql = strings.join('?')
    expect(sql).toMatch(/INSERT INTO user_profiles/)
    expect(sql).toMatch(/ON CONFLICT \("userId"\) DO UPDATE/)
    expect(sql).toMatch(/core_preferences, '\{\}'::jsonb\) \|\|/)
    expect(values).toContain('u1')
    expect(values).toContain('L1')
    expect(values).toContain('leagueRulesSeen')
    expect(values).toContain(JSON.stringify({ rulesSeenAt: 'a', lastSeenSettingsEventId: 'e', lastSeenSettingsEventAt: 'b' }))
  })

  it('a failed read is "nothing seen"', async () => {
    m.prisma.$queryRaw.mockRejectedValueOnce(new Error('db down'))
    expect(await getLeagueRulesSeen('u1', 'L1')).toEqual({ rulesSeenAt: null, lastSeenSettingsEventId: null, lastSeenSettingsEventAt: null })
  })
})
