// @vitest-environment node
/**
 * Handoff §5.4 tribe plan: Random (seeded), Balanced by AF (snake), Manual, the 4–6 rule, the
 * DB-first strength scale, and the route's lock — commissioner-only, validated server-side against
 * the CURRENT cast, frozen in settings, refused after the draft starts. Members never get the cast's
 * AF strengths.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { defaultTribeSlots } from '@/lib/survivor/survivorTribeIdentity'
import {
  planBalanced,
  planRandom,
  readLockedTribePlanMapping,
  strengthsFromAdp,
  tribeStrengths,
  validateTribePlan,
  type PlanParticipant,
} from '@/lib/survivor/survivorTribePlan'

const cast = (n: number, strength?: (i: number) => number | null): PlanParticipant[] =>
  Array.from({ length: n }, (_, i) => ({ userId: `u${String(i).padStart(2, '0')}`, displayName: `Manager ${i}`, strength: strength ? strength(i) : null }))

describe('tribe plan maths', () => {
  it('Random is seeded: same seed same tribes, a re-roll changes them, capacities hold', () => {
    const people = cast(16)
    const a = planRandom(people, [4, 4, 4, 4], 42)!
    expect(planRandom(people, [4, 4, 4, 4], 42)).toEqual(a)
    expect(planRandom(people, [4, 4, 4, 4], 43)).not.toEqual(a)
    const sizes = [0, 1, 2, 3].map(s => Object.values(a).filter(v => v === s).length)
    expect(sizes).toEqual([4, 4, 4, 4])
  })

  it('Balanced by AF snakes strongest-first so tribe averages end up close', () => {
    const people = cast(16, i => 100 - i * 5)
    const m = planBalanced(people, [4, 4, 4, 4])!
    const { spread } = tribeStrengths(m, people, 4)
    const random = tribeStrengths(planRandom(people, [4, 4, 4, 4], 7)!, people, 4).spread
    expect(spread).not.toBeNull()
    expect(spread!).toBeLessThanOrEqual(random ?? Infinity)
    expect(spread!).toBeLessThanOrEqual(5)
    // The two strongest managers never share a tribe.
    expect(m.u00).not.toBe(m.u01)
  })

  it('Balanced respects uneven capacities', () => {
    const people = cast(17, i => i)
    const m = planBalanced(people, [5, 4, 4, 4])!
    expect([0, 1, 2, 3].map(s => Object.values(m).filter(v => v === s).length)).toEqual([5, 4, 4, 4])
  })

  it('every tribe must hold 4–6 managers and match its capacity; everyone must be placed', () => {
    const people = cast(12)
    const ok = planRandom(people, [4, 4, 4], 1)!
    expect(validateTribePlan(ok, people, [4, 4, 4])).toBeNull()
    expect(validateTribePlan({ ...ok, u00: undefined as never }, people, [4, 4, 4])).toMatch(/not in a tribe/)
    const three = cast(9)
    expect(validateTribePlan(planRandom(three, [3, 3, 3], 1)!, three, [3, 3, 3])).toMatch(/4–6/)
    const moved = { ...ok, u00: (ok.u00 + 1) % 3 }
    expect(validateTribePlan(moved, people, [4, 4, 4])).toMatch(/capacity|4–6/)
  })

  it('AF strength scales DB ADP so the best roster reads 100, and no data stays null', () => {
    const s = strengthsFromAdp(new Map([['a', [1, 12]], ['b', [100, 200]], ['c', []]]))
    expect(s.get('a')).toBe(100)
    expect(s.get('b')).toBeGreaterThan(0)
    expect(s.get('b')).toBeLessThan(100)
    expect(s.get('c')).toBeNull()
  })

  it('only a LOCKED plan feeds post-draft assignment', () => {
    expect(readLockedTribePlanMapping({ survivorTribePlan: { mode: 'manual', seed: 1, mapping: { u1: 0 } } })).toBeNull()
    expect(readLockedTribePlanMapping({ survivorTribePlan: { mode: 'manual', seed: 1, mapping: { u1: 0 }, lockedAt: '2026-10-18T00:00:00Z' } })).toEqual({ u1: 0 })
  })
})

const mock = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), lock: vi.fn(), post: vi.fn(), adp: vi.fn(),
  db: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    draftSession: { findFirst: vi.fn() },
    survivorTribeMember: { count: vi.fn() },
    survivorLeagueConfig: { upsert: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
    roster: { findMany: vi.fn() },
    appUser: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock('next-auth', () => ({ getServerSession: mock.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mock.db }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({ resolveSurvivorAccessContext: mock.access }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: mock.lock }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: mock.post }))
vi.mock('@/lib/adp/resolveAdp', () => ({ loadAdpBySleeperId: mock.adp }))

const ctx = { params: Promise.resolve({ leagueId: 'league' }) }
const users = Array.from({ length: 16 }, (_, i) => ({ id: `u${String(i).padStart(2, '0')}`, displayName: `Manager ${i}`, username: null }))
const slots = defaultTribeSlots(16, 4)
const lockReq = (plan: unknown) => new NextRequest('http://localhost/api/leagues/league/survivor-tribe-setup', { method: 'POST', body: JSON.stringify({ plan }) })
const people = users.map(u => ({ userId: u.id, displayName: u.displayName, strength: null }))

describe('POST /survivor-tribe-setup — Lock tribes & announce', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.session.mockResolvedValue({ user: { id: 'commish' } })
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: true } })
    mock.lock.mockImplementation((_id, work) => work(mock.db))
    mock.db.league.findUnique.mockResolvedValue({ sport: 'NFL', survivorMode: true, userId: 'commish', settings: { defaultTeamCount: 16, tribeCount: 4, survivorTribeSlots: slots } })
    mock.db.draftSession.findFirst.mockResolvedValue({ status: 'pre_draft' })
    mock.db.survivorTribeMember.count.mockResolvedValue(0)
    mock.db.roster.findMany.mockResolvedValue(users.map((u, i) => ({ id: `r${i}`, platformUserId: u.id, playerData: { players: [] } })))
    mock.db.appUser.findMany.mockResolvedValue(users)
    mock.adp.mockResolvedValue(new Map())
    mock.post.mockResolvedValue({ id: 'm1' })
  })

  it('locks a valid plan into settings and announces it in league chat', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/survivor-tribe-setup/route')
    const mapping = planRandom(people, slots.map(s => s.managerCount), 9)!
    const res = await POST(lockReq({ mode: 'random', seed: 9, mapping, showOnBoard: true, tribeChatDuringDraft: true, announceInChat: true }), ctx)
    expect(res.status).toBe(200)
    const saved = mock.db.league.update.mock.calls[0][0].data.settings.survivorTribePlan
    expect(saved.mapping).toEqual(mapping)
    expect(typeof saved.lockedAt).toBe('string')
    expect(mock.post).toHaveBeenCalledOnce()
    expect(String(mock.post.mock.calls[0][2])).toMatch(/Tribes are set/)
  })

  it('refuses a plan that breaks the 4–6 rule, without writing', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/survivor-tribe-setup/route')
    const lopsided = Object.fromEntries(users.map((u, i) => [u.id, i < 10 ? 0 : 1 + (i % 3)]))
    expect((await POST(lockReq({ mode: 'manual', seed: 1, mapping: lopsided }), ctx)).status).toBe(422)
    expect(mock.db.league.update).not.toHaveBeenCalled()
    expect(mock.post).not.toHaveBeenCalled()
  })

  it('refuses while seats are unclaimed', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/survivor-tribe-setup/route')
    mock.db.appUser.findMany.mockResolvedValue(users.slice(0, 15))
    const mapping = planRandom(people, slots.map(s => s.managerCount), 9)!
    const res = await POST(lockReq({ mode: 'random', seed: 9, mapping }), ctx)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toMatch(/15 of 16 seats/)
  })

  it('is commissioner-only and closes once the draft starts', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/survivor-tribe-setup/route')
    const mapping = planRandom(people, slots.map(s => s.managerCount), 9)!
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: false } })
    expect((await POST(lockReq({ mode: 'random', seed: 9, mapping }), ctx)).status).toBe(403)
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: true } })
    mock.db.draftSession.findFirst.mockResolvedValue({ status: 'in_progress' })
    expect((await POST(lockReq({ mode: 'random', seed: 9, mapping }), ctx)).status).toBe(409)
    expect(mock.db.league.update).not.toHaveBeenCalled()
  })

  it('GET gives members no cast strengths; the commissioner gets the cast', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/survivor-tribe-setup/route')
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: false } })
    const member = await (await GET(lockReq(null), ctx)).json()
    expect(member.participants).toEqual([])
    mock.access.mockResolvedValue({ isLeagueMember: true, decisions: { canUpdateSettings: true } })
    const commish = await (await GET(lockReq(null), ctx)).json()
    expect(commish.participants).toHaveLength(16)
  })
})
