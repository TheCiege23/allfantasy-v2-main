/**
 * The commissioner's "Chimmy Auto lineups" switch (League.autoCoachEnabled) is off for everyone, paid
 * plans included (owner rule). AutoCoachEngine honoured it; POST .../roster/ai-apply-lineup checked the
 * paid plan but never read the switch, so a paid manager could still apply Chimmy's lineup.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  autoCoachEnabled: false as boolean | null,
  rosterLookup: vi.fn(async () => null),
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai/action-validation', () => ({ validateAiActionExecution: vi.fn(() => ({ ok: true })) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn(async () => ({ hasAccess: true }))
  }),
}))
vi.mock('@/lib/league/viewerTeams', () => ({
  resolveActingRoster: vi.fn(async () => ({ ok: true, rosterId: 'r1' })),
  requestedRosterIdFrom: vi.fn(() => null),
  actingTeamRefusal: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({
        id: 'L', userId: 'owner', leagueVariant: null, sport: 'NFL', settings: {}, season: 2026,
        autoCoachEnabled: m.autoCoachEnabled,
      })),
    },
    roster: { findFirst: m.rosterLookup },
  },
}))

type RoutePost = (typeof import('@/app/api/leagues/[leagueId]/roster/ai-apply-lineup/route'))['POST']
let POST: RoutePost

// The route's import graph is large; load it once, outside the per-test timeout.
beforeAll(async () => {
  POST = (await import('@/app/api/leagues/[leagueId]/roster/ai-apply-lineup/route')).POST
}, 180_000)

async function apply() {
  const req = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ week: 1, roster: {} }) })
  return POST(req as never, { params: Promise.resolve({ leagueId: 'L' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('apply Chimmy lineup honours the commissioner switch', () => {
  it('🛑 switched off: a paid manager is refused before any roster is read', async () => {
    m.autoCoachEnabled = false
    const res = await apply()
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code?: string }).code).toBe('AUTO_COACH_DISABLED_BY_COMMISSIONER')
    expect(m.rosterLookup).not.toHaveBeenCalled()
  })

  it.each([[true], [null]])('[control] switch %s: the route goes on to the roster (404 here: no roster in the mock)', async (on) => {
    m.autoCoachEnabled = on
    const res = await apply()
    expect(res.status).toBe(404)
    expect(m.rosterLookup).toHaveBeenCalledOnce()
  })
})
