import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => {
  const leagues = new Map<string, { id: string; userId: string; season: number; name: string; settings: Record<string, unknown> }>()
  const lockCalls: string[] = []
  const league = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => leagues.get(where.id) ?? null),
    findMany: vi.fn(async ({ where }: { where: { userId?: string; id?: { in: string[] } } }) =>
      [...leagues.values()].filter((l) => (where.userId ? l.userId === where.userId : true) && (where.id ? where.id.in.includes(l.id) : true)),
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { settings: Record<string, unknown> } }) => {
      const l = leagues.get(where.id)!
      l.settings = data.settings
      return l
    }),
  }
  const prisma = {
    league,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ league, $queryRaw: vi.fn(async (strings: TemplateStringsArray, id: string) => { lockCalls.push(`${strings.join('?')}|${id}`); return [] }) }),
    ),
  }
  return { leagues, prisma, lockCalls }
})

vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }))
const membership = vi.hoisted(() => vi.fn(async (_l: string, _u: string) => ({ ok: true })))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: membership }))

import { publicReputationForLeagues, readLeagueRatingView, setReputationPublic, submitRating } from '@/lib/commish-reputation/reputationService'

const five = { fairness: 5, communication: 5, responsiveness: 5, organization: 5, enjoyment: 5 }

function seed(id: string, userId: string, settings: Record<string, unknown> = {}) {
  db.leagues.set(id, { id, userId, season: 2026, name: id, settings })
}

beforeEach(() => {
  db.leagues.clear()
  db.lockCalls.length = 0
  membership.mockReset()
  membership.mockResolvedValue({ ok: true })
})

describe('submitRating', () => {
  it('stores one rating per manager per season, under the row lock, keeping other settings', async () => {
    seed('L1', 'commish', { scoring: 'ppr' })
    expect(await submitRating('L1', 'm1', { ratings: five, comment: '  great  ' })).toEqual({ ok: true })
    expect(db.lockCalls.some((c) => c.includes('FOR UPDATE') && c.endsWith('|L1'))).toBe(true)
    const s = db.leagues.get('L1')!.settings
    expect(s.scoring).toBe('ppr')
    expect((s.commissioner_ratings as { entries: Array<{ userId: string; comment: string }> }).entries).toMatchObject([{ userId: 'm1', comment: 'great' }])
    expect(await submitRating('L1', 'm1', { ratings: five })).toEqual({ ok: false, error: 'duplicate' })
  })
  it('refuses non-members, the commissioner, and bad ratings', async () => {
    seed('L1', 'commish')
    membership.mockResolvedValueOnce({ ok: false, reason: 'not_member', status: 403 } as never)
    expect(await submitRating('L1', 'outsider', { ratings: five })).toEqual({ ok: false, error: 'not_member' })
    expect(await submitRating('L1', 'commish', { ratings: five })).toEqual({ ok: false, error: 'self' })
    expect(await submitRating('L1', 'm1', { ratings: { ...five, fairness: 0 } })).toEqual({ ok: false, error: 'invalid_fairness' })
    expect(await submitRating('nope', 'm1', { ratings: five })).toEqual({ ok: false, error: 'not_found' })
  })
})

describe('publicReputationForLeagues', () => {
  it('only for leagues opted in, scored across ALL the commissioner\'s leagues', async () => {
    const entries = (users: string[]) => ({ entries: users.map((u) => ({ userId: u, season: 2026, ratings: five, comment: null, submittedAt: 'x' })) })
    // Ratings live in an old league; the listed league has none of its own.
    seed('old', 'c1', { commissioner_ratings: entries(['a', 'b', 'c', 'd', 'e']) })
    seed('listed', 'c1', { commissioner_reputation_public: true })
    seed('hidden', 'c2', { commissioner_ratings: entries(['a', 'b', 'c', 'd', 'e']) })
    const map = await publicReputationForLeagues(['listed', 'hidden'])
    expect(map.get('listed')).toEqual({ kind: 'rated', overall: 5, ratings: 5, leagues: 1, wellRun: true })
    expect(map.has('hidden')).toBe(false)
  })
})

describe('commissioner view and opt-in', () => {
  it('gives the commissioner their reputation and the switch; managers get none', async () => {
    seed('L1', 'commish')
    expect((await readLeagueRatingView('L1', 'm1'))?.reputation).toBeNull()
    expect((await readLeagueRatingView('L1', 'commish'))?.reputation).toMatchObject({ isPublic: false, public: { kind: 'new', ratings: 0 } })
    await setReputationPublic('L1', true)
    expect((await readLeagueRatingView('L1', 'commish'))?.reputation?.isPublic).toBe(true)
    await setReputationPublic('L1', false)
    expect('commissioner_reputation_public' in db.leagues.get('L1')!.settings).toBe(false)
  })
})
