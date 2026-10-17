// @vitest-environment node
/**
 * "Ask the commissioner" around the division gate (ADR F2.10a rule 6), ported from PR #1753.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DivisionGateDecision } from '@/lib/class-rating/divisionGate'
import type { ManagerClass } from '@/lib/class-rating/reads'

const s = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  gate: { outcome: 'allow', reason: 'in_band', userDivision: 3, leagueDivision: 3 } as DivisionGateDecision,
  classes: new Map<string, ManagerClass>(),
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
vi.mock('@/lib/class-rating/reads', () => ({ getManagerClass: vi.fn(async (id: string) => s.classes.get(id) ?? { status: 'unrated' }) }))
vi.mock('@/lib/class-rating/divisionGate', async (orig) => ({
  ...(await orig<typeof import('@/lib/class-rating/divisionGate')>()),
  getLeagueDivision: vi.fn(async () => 3),
}))
vi.mock('@/lib/league-join/joinDivisionGate', () => ({
  evaluateJoinDivisionGate: vi.fn(async () => s.gate),
  isOpenLeague: vi.fn(() => true),
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

const est = (division: number): ManagerClass => ({
  status: 'established', rating: 1500, rd: 60, games: 40, classLevel: division * 5, division, percentile: 0.5, computedAt: 'x',
})
const DENY: DivisionGateDecision = { outcome: 'deny', reason: 'outside_division_band', userDivision: 1, leagueDivision: 3, band: [2, 4] }

beforeEach(() => {
  s.settings = { inviteCode: 'CODE1' }
  s.gate = { outcome: 'allow', reason: 'in_band', userDivision: 3, leagueDivision: 3 }
  s.classes = new Map([['newbie', est(1)]])
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
    expect(isClassGateBlocked({ code: 'DIVISION_GATE_BLOCKED', error: 'x' })).toBe(true)
    expect(isClassGateBlocked({ code: 'RANK_GATE_BLOCKED' })).toBe(false)
    expect(isClassGateBlocked({ error: 'DIVISION_GATE_BLOCKED' })).toBe(false)
    expect(isClassGateBlocked(null)).toBe(false)
  })
})

describe('requestClassException — the manager side', () => {
  it('🛑 records nothing when the gate would let them in', async () => {
    expect(await requestClassException({ leagueId: 'L1', userId: 'newbie' })).toEqual({ ok: true, status: 'not_needed' })
    expect(s.writes).toEqual([])
    expect(s.notified).toEqual([])
  })

  it('records a refused manager under the league lock, with their division, and tells every commissioner', async () => {
    s.gate = DENY
    expect(await requestClassException({ leagueId: 'L1', userId: 'newbie' })).toEqual({ ok: true, status: 'requested' })
    expect(s.locked).toEqual(['L1'])
    expect(readClassJoinRequests(s.settings)).toMatchObject([{ userId: 'newbie', divisionAtRequest: 1 }])
    expect(s.notified).toHaveLength(1)
    expect(s.notified[0].userIds.sort()).toEqual(['co-commish', 'commish'])
    expect(s.notified[0].title).toBe('@rookie_rae asked to join Gridiron Gang')
    expect(s.notified[0].body).toContain('@rookie_rae is in Division 1; your league plays in Division 3, so open joins are for Divisions 2–4.')
  })

  it('asking twice does not notify twice; an excepted manager is told to join', async () => {
    s.gate = DENY
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
    expect(readClassExceptions(s.settings)).toMatchObject([{ userId: 'newbie', via: 'request', grantedBy: 'commish', divisionAtGrant: 1 }])
    expect(readClassJoinRequests(s.settings)).toEqual([])
    expect(s.notified.at(-1)).toMatchObject({ userIds: ['newbie'], type: 'class_join_approved', title: 'You can join Gridiron Gang' })
    if (r.ok) expect(r.summary).toMatchObject({ division: 3, band: [2, 4], open: true, exceptions: [{ userId: 'newbie', classLevel: 5, division: 1 }] })
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

  it('the summary shows a provisional or unrated requester without inventing a Class', async () => {
    s.classes.set('prov', { status: 'provisional', rating: 1510, rd: 170, games: 3, establishedAtRd: 100, computedAt: 'x' })
    s.settings = withClassJoinRequest(withClassJoinRequest(s.settings, { userId: 'prov', divisionAtRequest: null }), { userId: 'nobody', divisionAtRequest: null })
    const summary = await getClassGateSummary('L1')
    expect(summary?.requests.map((r) => [r.userId, r.classLevel, r.division, r.provisional])).toEqual([
      ['prov', null, null, true],
      ['nobody', null, null, false],
    ])
  })
})
