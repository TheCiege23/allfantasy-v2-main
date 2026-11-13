// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = new Map<string, string>()
const state = {
  admin: { status: 'admin' as 'admin' | 'none', user: { id: 'usr-admin', email: 'owner@example.test' } as { id?: string; email?: string } },
  role: 'commissioner',
  /** Per-league role override; falls back to `role`. */
  roles: {} as Record<string, string>,
  leagues: new Set(['lg-1']),
  /** Rows by provider id, as `league.findMany({ where: { platformLeagueId } })` would return them. */
  byPlatform: {} as Record<string, Array<{ id: string; season: number }>>,
}

const tx = {
  league: {
    findUnique: vi.fn(async () => ({ id: 'lg-t', settings: { foo: 1 } })),
    update: vi.fn(async () => ({})),
    count: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
  },
  leagueEntrySlot: {
    findMany: vi.fn(async () => [
      { id: 's2', slotNumber: 2, rosterId: 'r2' },
      { id: 's3', slotNumber: 3, rosterId: 'r3' },
    ]),
    update: vi.fn(async () => ({})),
  },
  roster: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, settings: { openSlot: true, aiManaged: false } })),
    update: vi.fn(async () => ({})),
  },
  leagueTeam: { updateMany: vi.fn(async () => ({ count: 1 })) },
  draftSession: {
    findMany: vi.fn(async () => [{ id: 'd1', slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'Me' }, { slot: 2, rosterId: 'r2', displayName: 'Open Team 2', open: true }] }]),
    update: vi.fn(async () => ({})),
  },
}

const prisma = {
  ...tx,
  platformConfig: {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (config.has(where.key) ? { value: config.get(where.key)! } : null)),
    upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => {
      config.set(where.key, config.has(where.key) ? update.value : create.value)
      return {}
    }),
    deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
      config.delete(where.key)
      return { count: 1 }
    }),
  },
  league: {
    ...tx.league,
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      state.leagues.has(where.id) ? { id: where.id, name: 'Real Name', platform: 'sleeper', sport: 'NFL', season: 2026, settings: {} } : where.id === 'lg-t' ? { id: 'lg-t', settings: { foo: 1 } } : null,
    ),
  },
  $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
}
;(prisma.league as unknown as { findMany: unknown }).findMany = vi.fn(async ({ where }: { where: { platformLeagueId?: string } }) =>
  [...(state.byPlatform[where.platformLeagueId ?? ''] ?? [])].sort((a, b) => b.season - a.season),
)

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/adminAuth', () => ({
  requireAdmin: vi.fn(async () =>
    state.admin.status === 'admin'
      ? { ok: true, user: state.admin.user }
      : { ok: false, res: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) },
  ),
}))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async (leagueId: string) => state.roles[leagueId] ?? state.role),
  isCommissionerRole: (r: string) => r === 'commissioner' || r === 'co_commissioner',
}))

function put(body: unknown) {
  return new Request('http://localhost/api/admin/demo-league', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

describe('/api/admin/demo-league — only the admin who commissions the league can set it', () => {
  beforeEach(() => {
    config.clear()
    state.admin = { status: 'admin', user: { id: 'usr-admin', email: 'owner@example.test' } }
    state.role = 'commissioner'
    state.roles = {}
    state.byPlatform = {}
    delete process.env.DEMO_LEAGUE_ADMIN_EMAILS
  })

  it('refuses a non-admin', async () => {
    state.admin.status = 'none'
    const { PUT, GET } = await import('@/app/api/admin/demo-league/route')
    expect((await PUT(put({ leagueId: 'lg-1' }))).status).toBe(401)
    expect((await GET()).status).toBe(401)
    expect(config.size).toBe(0)
  })

  it('refuses the shared admin password session (no user id)', async () => {
    state.admin.user = {}
    const { PUT } = await import('@/app/api/admin/demo-league/route')
    expect((await PUT(put({ leagueId: 'lg-1' }))).status).toBe(403)
    expect(config.size).toBe(0)
  })

  it('refuses a league the admin does not commission', async () => {
    state.role = 'member'
    const { PUT } = await import('@/app/api/admin/demo-league/route')
    expect((await PUT(put({ leagueId: 'lg-1' }))).status).toBe(403)
    expect(config.size).toBe(0)
  })

  it('refuses an admin outside DEMO_LEAGUE_ADMIN_EMAILS when it is set', async () => {
    process.env.DEMO_LEAGUE_ADMIN_EMAILS = 'someone-else@example.test'
    const { PUT } = await import('@/app/api/admin/demo-league/route')
    expect((await PUT(put({ leagueId: 'lg-1' }))).status).toBe(403)
  })

  it('404s an unknown league, then saves, reads back and clears a commissioned one', async () => {
    const { PUT, GET, DELETE } = await import('@/app/api/admin/demo-league/route')
    expect((await PUT(put({ leagueId: 'nope' }))).status).toBe(404)
    const ok = await PUT(put({ leagueId: 'lg-1' }))
    expect(ok.status).toBe(200)
    expect(JSON.parse(config.get('demo_league.source.v1')!).leagueId).toBe('lg-1')
    expect((await (await GET()).json()).configured).toBe(true)
    expect((await DELETE()).status).toBe(200)
    expect(config.has('demo_league.source.v1')).toBe(false)
  })
})

describe('/api/admin/demo-league — accepts the provider league id too', () => {
  beforeEach(() => {
    config.clear()
    state.admin = { status: 'admin', user: { id: 'usr-admin', email: 'owner@example.test' } }
    state.role = 'commissioner'
    state.roles = {}
    state.byPlatform = { '1313549607426334720': [{ id: 'lg-2025', season: 2025 }, { id: 'lg-2026', season: 2026 }] }
  })

  it('resolves a Sleeper-style id to the newest season the admin commissions', async () => {
    const { PUT } = await import('@/app/api/admin/demo-league/route')
    expect((await PUT(put({ leagueId: '1313549607426334720' }))).status).toBe(200)
    expect(JSON.parse(config.get('demo_league.source.v1')!).leagueId).toBe('lg-2026')
  })

  it('skips a newer season the admin does not commission', async () => {
    state.role = 'member'
    state.roles = { 'lg-2025': 'commissioner' }
    const { PUT } = await import('@/app/api/admin/demo-league/route')
    expect((await PUT(put({ leagueId: '1313549607426334720' }))).status).toBe(200)
    expect(JSON.parse(config.get('demo_league.source.v1')!).leagueId).toBe('lg-2025')
  })

  it('refuses a provider id whose leagues the admin does not commission', async () => {
    state.role = 'member'
    const { PUT } = await import('@/app/api/admin/demo-league/route')
    expect((await PUT(put({ leagueId: '1313549607426334720' }))).status).toBe(403)
    expect(config.size).toBe(0)
  })

  it('404s an id that matches neither our id nor a provider id, with a message naming both', async () => {
    const { PUT } = await import('@/app/api/admin/demo-league/route')
    const res = await PUT(put({ leagueId: '999' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/provider/i)
  })
})

describe('fillTestLeagueWithPlaceholders', () => {
  it('turns every open seat into a placeholder AI seat and marks the league as a test league', async () => {
    const { fillTestLeagueWithPlaceholders, TEST_PLACEHOLDER_PREFIX } = await import('@/lib/demo-league/testLeagueFill')
    const out = await fillTestLeagueWithPlaceholders('lg-t')
    expect(out.filled).toBe(2)
    const rosterUpdate = tx.roster.update.mock.calls[0]![0] as { data: { platformUserId: string; settings: Record<string, unknown> } }
    expect(rosterUpdate.data.platformUserId.startsWith(TEST_PLACEHOLDER_PREFIX)).toBe(true)
    // `orphan-` prefix → isSeatPlaceholderUserId → never addressed by a notification.
    expect(rosterUpdate.data.platformUserId.startsWith('orphan-')).toBe(true)
    expect(rosterUpdate.data.settings).toMatchObject({ openSlot: false, aiManaged: true, testPlaceholder: true })
    const teamUpdate = tx.leagueTeam.updateMany.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> }
    expect(teamUpdate.where).toMatchObject({ claimedByUserId: null })
    expect(teamUpdate.data).toMatchObject({ ownerName: 'Test Manager 2', teamName: 'Test Team 2', managerKind: 'AI', isOrphan: false })
    const slotOrder = (tx.draftSession.update.mock.calls[0]![0] as { data: { slotOrder: Array<Record<string, unknown>> } }).data.slotOrder
    expect(slotOrder[0]).toMatchObject({ displayName: 'Me' })
    expect(slotOrder[1]).toMatchObject({ displayName: 'Test Team 2', open: false })
    expect((tx.league.update.mock.calls[0]![0] as { data: { settings: Record<string, unknown> } }).data.settings).toEqual({ foo: 1, isTestLeague: true })
  })
})

describe('analytics exclusion', () => {
  it('subtracts test leagues using a POSITIVE match, never a NOT filter', async () => {
    prisma.league.count = vi.fn(async (args?: { where?: Record<string, unknown> }) => (JSON.stringify(args ?? {}).includes('isTestLeague') ? 3 : 40)) as never
    const { countRealLeagues } = await import('@/lib/demo-league/analyticsExclusion')
    expect(await countRealLeagues()).toBe(37)
    expect(await countRealLeagues({ sport: 'NFL' } as never)).toBe(37)
    const calls = (prisma.league.count as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => JSON.stringify(c[0] ?? {}))
    expect(calls.some((c) => c.includes('"NOT"'))).toBe(false)
  })
})
