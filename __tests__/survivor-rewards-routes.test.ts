// @vitest-environment node
/**
 * Reward routes: the Commissioner Hub's grant_reward / choose_reward_target / reverse_reward
 * actions (commissioner only, bad input 400) and the manager's own /api/survivor/rewards
 * (members only, own rewards only, the holder's choice).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'commish' } } as { user?: { id?: string } } | null,
  commissioner: true,
  member: true,
  db: {
    survivorCommissionerAction: { create: vi.fn() },
    roster: { findFirst: vi.fn() },
    league: { findUnique: vi.fn() },
  },
  apply: vi.fn(),
  choose: vi.fn(),
  reverse: vi.fn(),
  list: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerRole: async () => {
    if (!h.commissioner) throw new Response('Forbidden', { status: 403 })
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: async () => (h.member ? { ok: true } : null) }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: async () => null }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: vi.fn() }))
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueNotification: vi.fn() }))
vi.mock('@/lib/redraft/voidPendingTradesForElimination', () => ({ voidPendingRedraftTradesForRoster: vi.fn() }))
vi.mock('@/lib/survivor/survivorCouncilPause', () => ({ setCouncilPaused: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({
  applySurvivorReward: h.apply,
  chooseSurvivorRewardTarget: h.choose,
  reverseSurvivorReward: h.reverse,
  listSurvivorRewards: h.list,
}))

import { GET as commishGET, POST as commishPOST } from '@/app/api/survivor/commissioner/route'
import { GET as rewardsGET, POST as rewardsPOST } from '@/app/api/survivor/rewards/route'
import { NextRequest } from 'next/server'

const post = (fn: typeof commishPOST, url: string, body: object) => fn(new Request(url, { method: 'POST', body: JSON.stringify(body) }) as never)
const ok = (extra: object = {}) => ({ ok: true, rewardId: 'k', status: 'applied', duplicate: false, changes: [], note: null, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  h.session = { user: { id: 'commish' } }
  h.commissioner = true
  h.member = true
  h.apply.mockResolvedValue(ok())
  h.choose.mockResolvedValue(ok())
  h.reverse.mockResolvedValue(ok({ status: 'reversed' }))
  h.list.mockResolvedValue([])
  h.db.roster.findFirst.mockResolvedValue({ id: 'my-roster' })
  h.db.league.findUnique.mockResolvedValue({ language: 'es' })
})

describe('Commissioner Hub reward actions', () => {
  const url = 'https://x.test/api/survivor/commissioner'

  it('grants a reward through the one reward API and logs it', async () => {
    const res = await post(commishPOST, url, { leagueId: 'L1', action: 'grant_reward', requestId: 'req-1', week: 6, reward: { type: 'score_penalty', rosterId: 'r1', points: 20 } })
    expect(res.status).toBe(200)
    expect(h.apply).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', idempotencyKey: 'commissioner:commish:req-1', week: 6, source: expect.objectContaining({ kind: 'commissioner' }), actorUserId: 'commish' }))
    expect(h.db.survivorCommissionerAction.create).toHaveBeenCalledTimes(1)
  })

  it('400s without a request id, and maps an invalid reward to 400', async () => {
    expect((await post(commishPOST, url, { leagueId: 'L1', action: 'grant_reward', week: 6, reward: {} })).status).toBe(400)
    h.apply.mockResolvedValue({ ok: false, code: 'invalid', error: 'Points must be more than 0' })
    const res = await post(commishPOST, url, { leagueId: 'L1', action: 'grant_reward', requestId: 'r', week: 6, reward: { type: 'score_penalty', rosterId: 'r1', points: 0 } })
    expect(res.status).toBe(400)
    expect(h.db.survivorCommissionerAction.create).not.toHaveBeenCalled()
  })

  it('reverses and chooses as the commissioner', async () => {
    expect((await post(commishPOST, url, { leagueId: 'L1', action: 'reverse_reward', rewardId: 'k', notes: 'mistake' })).status).toBe(200)
    expect(h.reverse).toHaveBeenCalledWith({ leagueId: 'L1', rewardId: 'k', actorUserId: 'commish', reason: 'mistake' })
    expect((await post(commishPOST, url, { leagueId: 'L1', action: 'choose_reward_target', rewardId: 'k', targetRosterId: 'r2' })).status).toBe(200)
    expect(h.choose).toHaveBeenCalledWith(expect.objectContaining({ asCommissioner: true, targetRosterId: 'r2' }))
    expect((await post(commishPOST, url, { leagueId: 'L1', action: 'reverse_reward' })).status).toBe(400)
  })

  it('is commissioner only (403) for actions and the rewards list', async () => {
    h.commissioner = false
    expect((await post(commishPOST, url, { leagueId: 'L1', action: 'reverse_reward', rewardId: 'k' })).status).toBe(403)
    expect((await commishGET(new NextRequest('https://x.test/api/survivor/commissioner?leagueId=L1&type=rewards'))).status).toBe(403)
    expect(h.reverse).not.toHaveBeenCalled()
    expect(h.list).not.toHaveBeenCalled()
  })

  it('lists every reward for the commissioner', async () => {
    h.list.mockResolvedValue([{ rewardId: 'k' }])
    const res = await commishGET(new NextRequest('https://x.test/api/survivor/commissioner?leagueId=L1&type=rewards'))
    expect(await res.json()).toEqual({ rewards: [{ rewardId: 'k' }] })
    expect(h.list).toHaveBeenCalledWith('L1')
  })
})

describe('/api/survivor/rewards (a manager’s own)', () => {
  const url = 'https://x.test/api/survivor/rewards'

  it('returns only the caller’s rewards, described in the league language', async () => {
    h.session = { user: { id: 'manager' } }
    h.list.mockResolvedValue([{ rewardId: 'tp', type: 'tribemate_points', status: 'awaiting_choice', week: 5, applyWeek: 5, holderRosterIds: ['my-roster'], spec: { type: 'tribemate_points', chooserRosterId: 'my-roster', points: 50 } }])
    const res = await rewardsGET(new NextRequest(`${url}?leagueId=L1`))
    expect(res.status).toBe(200)
    expect(h.list).toHaveBeenCalledWith('L1', { rosterId: 'my-roster' })
    const body = await res.json()
    expect(body.rewards[0]).toMatchObject({ rewardId: 'tp', holder: true, text: expect.stringContaining('compañero') })
  })

  it('lets the holder choose, as themselves', async () => {
    h.session = { user: { id: 'manager' } }
    const res = await post(rewardsPOST as never, url, { leagueId: 'L1', rewardId: 'tp', targetRosterId: 'r2' })
    expect(res.status).toBe(200)
    expect(h.choose).toHaveBeenCalledWith(expect.objectContaining({ actorRosterId: 'my-roster', targetRosterId: 'r2', chosenBy: 'manager' }))
    h.choose.mockResolvedValue({ ok: false, code: 'forbidden', error: 'Only the winner can make this choice.' })
    expect((await post(rewardsPOST as never, url, { leagueId: 'L1', rewardId: 'tp', targetRosterId: 'r2' })).status).toBe(403)
  })

  it('401 signed out, 400 bad input, 403 non-member', async () => {
    h.session = null
    expect((await rewardsGET(new NextRequest(`${url}?leagueId=L1`))).status).toBe(401)
    h.session = { user: { id: 'manager' } }
    expect((await rewardsGET(new NextRequest(url))).status).toBe(400)
    expect((await post(rewardsPOST as never, url, { leagueId: 'L1' })).status).toBe(400)
    h.member = false
    expect((await rewardsGET(new NextRequest(`${url}?leagueId=L1`))).status).toBe(403)
    expect((await post(rewardsPOST as never, url, { leagueId: 'L1', rewardId: 'tp', targetRosterId: 'r2' })).status).toBe(403)
    expect(h.choose).not.toHaveBeenCalled()
  })
})
