// @vitest-environment node
/** Manager-specific commissioner approvals for Career Level joins. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  careerLevel: 1,
  users: [] as Array<{ id: string; username: string | null; displayName: string | null }>,
  locked: [] as string[],
  writes: [] as Array<Record<string, unknown>>,
  notified: [] as Array<{ userIds: string[]; type: string; title: string; body: string }>,
}))

vi.mock('@/lib/prisma', () => {
  const league = {
    findUnique: vi.fn(async () => ({ id: 'L1', name: 'Gridiron Gang', userId: 'commish', settings: s.settings })),
    update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
      s.writes.push(data.settings)
      s.settings = data.settings
      return {}
    }),
  }
  return {
    prisma: {
      league,
      userProfile: { findMany: vi.fn(async () => [{ userId: 'newbie', xpLevel: s.careerLevel, xpTotal: null }]) },
      leagueTeam: { findMany: vi.fn(async () => [{ claimedByUserId: 'co-commish' }]) },
      appUser: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => s.users.filter((u) => where.id.in.includes(u.id))),
        findFirst: vi.fn(async ({ where }: { where: { username: { equals: string } } }) =>
          s.users.find((u) => u.username?.toLowerCase() === where.username.equals.toLowerCase()) ?? null,
        ),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (strings.join('?').includes('FOR UPDATE')) s.locked.push(String(values[0]))
            return []
          }),
          league,
        }),
      ),
    },
  }
})
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn(async () => 'member') }))
vi.mock('@/lib/adminAuth', () => ({ isAdminRole: () => false, isAdminEmailAllowed: () => false }))
vi.mock('@/lib/rank/careerLedger', () => ({
  loadCareerLedger: vi.fn(async (ids: string[]) => ids.includes('newbie')
    ? [{ userId: 'newbie', platform: 'sleeper', wins: 8, losses: 6, ties: 0, season: 2024, leagueSize: 12, gamesPlayed: 14, wonChampionship: true }]
    : []),
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: vi.fn(async (n: { userIds: string[]; type: string; title: string; body: string }) => {
    s.notified.push(n)
  }),
}))

import {
  hasClassException,
  readClassExceptions,
  readClassJoinRequests,
  withClassException,
  withClassJoinRequest,
  withoutClassException,
  withoutClassJoinRequest,
  MAX_CLASS_REQUESTS,
} from '@/lib/class-rating/exceptions'
import { decideClassException, getClassGateSummary, requestClassException } from '@/lib/league-join/classRequests'
import { isClassGateBlocked } from '@/components/league-join/ClassGateNotice'

beforeEach(() => {
  s.settings = { inviteCode: 'CODE1', creatorRankLevel: 10 }
  s.careerLevel = 10
  s.users = [{ id: 'newbie', username: 'rookie_rae', displayName: null }]
  s.locked = []
  s.writes = []
  s.notified = []
})

describe('exceptions on League.settings — pure', () => {
  it('reads one entry per manager and drops malformed ones', () => {
    const settings = {
      classExceptions: [{ userId: 'a', via: 'request', divisionAtGrant: 2 }, { userId: 'a' }, { nope: 1 }, 'x', { userId: 'b', divisionAtGrant: 9 }],
      classJoinRequests: [{ userId: 'c', divisionAtRequest: 1 }],
    }
    expect(readClassExceptions(settings).map((e) => [e.userId, e.via, e.divisionAtGrant])).toEqual([['a', 'request', 2], ['b', 'direct', null]])
    expect(readClassJoinRequests(settings)).toMatchObject([{ userId: 'c', divisionAtRequest: 1 }])
    expect(readClassExceptions(null)).toEqual([])
  })

  it('a repeat request keeps its place in the queue; the queue is bounded', () => {
    const first = withClassJoinRequest({}, { userId: 'a', divisionAtRequest: 1, now: new Date('2026-10-01T00:00:00Z') })
    const again = withClassJoinRequest(first, { userId: 'a', divisionAtRequest: 1, now: new Date('2026-10-05T00:00:00Z') })
    expect(readClassJoinRequests(again)).toMatchObject([{ userId: 'a', requestedAt: '2026-10-01T00:00:00.000Z' }])
    let many: Record<string, unknown> = {}
    for (let i = 0; i < MAX_CLASS_REQUESTS + 5; i++) many = withClassJoinRequest(many, { userId: `u${i}`, divisionAtRequest: null })
    expect(readClassJoinRequests(many)).toHaveLength(MAX_CLASS_REQUESTS)
  })

  it('granting answers the request; revoking and declining remove only what they name', () => {
    let st = withClassJoinRequest({ other: true }, { userId: 'a', divisionAtRequest: 1 })
    st = withClassException(st, { userId: 'a', grantedBy: 'commish', via: 'request', divisionAtGrant: 1 })
    expect(hasClassException(st, 'a')).toBe(true)
    expect(readClassJoinRequests(st)).toEqual([])
    expect(st.other).toBe(true)
    expect(hasClassException(withoutClassException(st, 'a'), 'a')).toBe(false)
    expect(readClassJoinRequests(withoutClassJoinRequest(withClassJoinRequest({}, { userId: 'b', divisionAtRequest: 2 }), 'b'))).toEqual([])
  })

  it('the join pages recognise exactly the division refusal', () => {
    expect(isClassGateBlocked({ code: 'CAREER_LEVEL_GATE_BLOCKED', error: 'x' })).toBe(true)
    expect(isClassGateBlocked({ code: 'RANK_GATE_BLOCKED' })).toBe(false)
    expect(isClassGateBlocked({ error: 'CAREER_LEVEL_GATE_BLOCKED' })).toBe(false)
    expect(isClassGateBlocked(null)).toBe(false)
  })
})

describe('requestClassException — the manager side', () => {
  it('🛑 records nothing when the gate would let them in', async () => {
    expect(await requestClassException({ leagueId: 'L1', userId: 'newbie' })).toEqual({ ok: true, status: 'not_needed' })
    expect(s.writes).toEqual([])
    expect(s.notified).toEqual([])
  })

  it('records a refused manager under the league lock, with their Career Level, and tells every commissioner', async () => {
    s.careerLevel = 6
    expect(await requestClassException({ leagueId: 'L1', userId: 'newbie' })).toEqual({ ok: true, status: 'requested' })
    expect(s.locked).toEqual(['L1'])
    expect(readClassJoinRequests(s.settings)).toMatchObject([{ userId: 'newbie', divisionAtRequest: null }])
    expect(s.notified).toHaveLength(1)
    expect(s.notified[0].userIds.sort()).toEqual(['co-commish', 'commish'])
    expect(s.notified[0].title).toBe('@rookie_rae asked to join Gridiron Gang')
    expect(s.notified[0].body).toContain('Career Level 6. This league allows direct joins from levels 7–13.')
    expect(s.notified[0].body).toContain('8–6–0 (W–L–T)')
  })

  it('asking twice does not notify twice; an excepted manager is told to join', async () => {
    s.careerLevel = 6
    await requestClassException({ leagueId: 'L1', userId: 'newbie' })
    expect(await requestClassException({ leagueId: 'L1', userId: 'newbie' })).toEqual({ ok: true, status: 'already_requested' })
    expect(s.notified).toHaveLength(1)
    s.settings = withClassException(s.settings, { userId: 'newbie', grantedBy: 'commish', via: 'direct', divisionAtGrant: 1 })
    expect(await requestClassException({ leagueId: 'L1', userId: 'newbie' })).toEqual({ ok: true, status: 'already_granted' })
  })
})

describe('decideClassException — the commissioner side', () => {
  it('approving a request makes that ONE manager an exception and tells them', async () => {
    s.settings = withClassJoinRequest(s.settings, { userId: 'newbie', divisionAtRequest: 1 })
    const r = await decideClassException({ leagueId: 'L1', decidedBy: 'commish', action: 'approve', userId: 'newbie' })
    expect(r.ok).toBe(true)
    expect(readClassExceptions(s.settings)).toMatchObject([{ userId: 'newbie', via: 'request', grantedBy: 'commish', divisionAtGrant: null }])
    expect(readClassJoinRequests(s.settings)).toEqual([])
    expect(s.notified.at(-1)).toMatchObject({ userIds: ['newbie'], type: 'class_join_approved', title: 'You can join Gridiron Gang' })
    if (r.ok) expect(r.summary).toMatchObject({ leagueLevel: 10, band: [7, 13], exceptions: [{ userId: 'newbie', careerLevel: 10 }] })
  })

  it('grants by username, refuses an unknown one, and will not approve a request that does not exist', async () => {
    expect(await decideClassException({ leagueId: 'L1', decidedBy: 'commish', action: 'grant', username: '@Rookie_Rae' })).toMatchObject({ ok: true })
    expect(hasClassException(s.settings, 'newbie')).toBe(true)
    expect(await decideClassException({ leagueId: 'L1', decidedBy: 'commish', action: 'grant', username: 'nobody' })).toMatchObject({ ok: false, status: 404 })
    expect(await decideClassException({ leagueId: 'L1', decidedBy: 'commish', action: 'approve', userId: 'ghost' })).toMatchObject({
      ok: false,
      status: 404,
      error: 'That manager has no pending request.',
    })
  })

  it('declining clears the request and says so; revoking is silent and keeps nothing', async () => {
    s.settings = withClassJoinRequest(s.settings, { userId: 'newbie', divisionAtRequest: 1 })
    await decideClassException({ leagueId: 'L1', decidedBy: 'commish', action: 'decline', userId: 'newbie' })
    expect(readClassJoinRequests(s.settings)).toEqual([])
    expect(s.notified.at(-1)).toMatchObject({ type: 'class_join_declined' })
    s.settings = withClassException(s.settings, { userId: 'newbie', grantedBy: 'commish', via: 'direct', divisionAtGrant: 1 })
    const before = s.notified.length
    await decideClassException({ leagueId: 'L1', decidedBy: 'commish', action: 'revoke', userId: 'newbie' })
    expect(hasClassException(s.settings, 'newbie')).toBe(false)
    expect(s.notified).toHaveLength(before)
  })

  it('includes the manager’s career history and gives a new manager Level 1', async () => {
    s.settings = withClassJoinRequest(withClassJoinRequest(s.settings, { userId: 'newbie', divisionAtRequest: null }), { userId: 'nobody', divisionAtRequest: null })
    const summary = await getClassGateSummary('L1')
    expect(summary?.requests).toMatchObject([
      { userId: 'newbie', careerLevel: 10, history: '1 season year · 1 league-season · 8–6–0 (W–L–T) · 1 title' },
      { userId: 'nobody', careerLevel: 1, history: 'No verified results on file.' },
    ])
  })
})
