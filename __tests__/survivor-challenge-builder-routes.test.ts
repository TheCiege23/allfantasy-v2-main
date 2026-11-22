// @vitest-environment node
/**
 * Challenge builder routes: the Commissioner Hub actions (commissioner only — a manager gets 403;
 * bad input 400; settle needs the confirm step) and the manager's /api/survivor/challenge-board
 * (signed-in members only; bad input 400).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'commish' } } as { user?: { id?: string } } | null,
  commissioner: true,
  member: true,
  db: { survivorCommissionerAction: { create: vi.fn() } },
  builder: {
    createBuilderChallenge: vi.fn(),
    updateBuilderChallenge: vi.fn(),
    openBuilderChallengeNow: vi.fn(),
    lockBuilderChallengeNow: vi.fn(),
    cancelBuilderChallenge: vi.fn(),
    previewBuilderSettlement: vi.fn(),
    settleBuilderChallenge: vi.fn(),
    reverseBuilderChallenge: vi.fn(),
    listBuilderChallengesForCommissioner: vi.fn(async () => []),
    builderMeta: vi.fn(async () => ({ currentWeek: 9 })),
    listChallengeGameChoices: vi.fn(async () => []),
    listChallengePlayerChoices: vi.fn(async () => []),
    loadBuilderBoard: vi.fn(async () => ({ lang: 'en', challenges: [] })),
    submitBuilderAnswer: vi.fn(),
  },
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
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ applySurvivorReward: vi.fn(), chooseSurvivorRewardTarget: vi.fn(), reverseSurvivorReward: vi.fn(), listSurvivorRewards: vi.fn() }))
vi.mock('@/lib/survivor/survivorChallengeBuilder', () => h.builder)

import { GET as commishGET, POST as commishPOST } from '@/app/api/survivor/commissioner/route'
import { GET as boardGET, POST as boardPOST } from '@/app/api/survivor/challenge-board/route'
import { NextRequest } from 'next/server'

const URL_C = 'https://x.test/api/survivor/commissioner'
const post = (fn: (req: never) => Promise<Response>, url: string, body: object) => fn(new Request(url, { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  h.session = { user: { id: 'commish' } }
  h.commissioner = true
  h.member = true
  h.builder.createBuilderChallenge.mockResolvedValue({ ok: true, challengeId: 'c1' })
  h.builder.settleBuilderChallenge.mockResolvedValue({ ok: true, outcome: 'settled' })
  h.builder.previewBuilderSettlement.mockResolvedValue({ ok: true, preview: { places: [], payouts: [] }, pending: null })
  h.builder.reverseBuilderChallenge.mockResolvedValue({ ok: true, reversed: 2 })
  h.builder.submitBuilderAnswer.mockResolvedValue({ ok: true, submission: { answer: { optionId: 'yes' }, wager: null } })
})

describe('Commissioner Hub challenge actions', () => {
  it('lets the commissioner create, logs it, and maps a validation failure to 400', async () => {
    const res = await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_create', challenge: { title: 'x' } })
    expect(res.status).toBe(200)
    expect(h.builder.createBuilderChallenge).toHaveBeenCalledWith('L1', 'commish', { title: 'x' })
    expect(h.db.survivorCommissionerAction.create).toHaveBeenCalledTimes(1)
    h.builder.createBuilderChallenge.mockResolvedValue({ ok: false, status: 400, error: 'Give the challenge a title', code: 'title' })
    const bad = await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_create', challenge: {} })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ code: 'title' })
  })

  it('403s a manager who is not the commissioner, before touching anything', async () => {
    h.commissioner = false
    const res = await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_create', challenge: { title: 'x' } })
    expect(res.status).toBe(403)
    expect(h.builder.createBuilderChallenge).not.toHaveBeenCalled()
    const get = await commishGET(new NextRequest(`${URL_C}?leagueId=L1&type=challenges`))
    expect(get.status).toBe(403)
  })

  it('400s on missing input', async () => {
    expect((await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_create' })).status).toBe(400)
    expect((await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_lock' })).status).toBe(400)
    expect((await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_bogus', challengeId: 'c1' })).status).toBe(400)
    expect((await commishGET(new NextRequest(`${URL_C}?leagueId=L1&type=challenge_games`))).status).toBe(400)
  })

  it('settles only after the confirm step; previews change nothing', async () => {
    const noConfirm = await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_settle', challengeId: 'c1', manual: { truth: { optionId: 'yes' } } })
    expect(noConfirm.status).toBe(400)
    expect(h.builder.settleBuilderChallenge).not.toHaveBeenCalled()
    await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_settle_preview', challengeId: 'c1', manual: { truth: { optionId: 'yes' } } })
    expect(h.builder.previewBuilderSettlement).toHaveBeenCalledWith('L1', 'c1', { truth: { optionId: 'yes' } })
    expect(h.db.survivorCommissionerAction.create).not.toHaveBeenCalled()
    const ok = await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_settle', challengeId: 'c1', confirm: true, manual: null })
    expect(ok.status).toBe(200)
    expect(h.builder.settleBuilderChallenge).toHaveBeenCalledWith('L1', 'c1', { manual: null, actorUserId: 'commish' })
  })

  it('reverses through the builder and passes its 409 through', async () => {
    expect((await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_reverse', challengeId: 'c1', notes: 'oops' })).status).toBe(200)
    expect(h.builder.reverseBuilderChallenge).toHaveBeenCalledWith('L1', 'c1', 'commish', 'oops')
    h.builder.reverseBuilderChallenge.mockResolvedValue({ ok: false, status: 409, error: 'Only a settled challenge can be reversed.' })
    expect((await post(commishPOST, URL_C, { leagueId: 'L1', action: 'challenge_reverse', challengeId: 'c1' })).status).toBe(409)
  })

  it('lists challenges with the form meta', async () => {
    const res = await commishGET(new NextRequest(`${URL_C}?leagueId=L1&type=challenges`))
    expect(await res.json()).toEqual({ challenges: [], meta: { currentWeek: 9 } })
  })
})

describe('/api/survivor/challenge-board', () => {
  const URL_B = 'https://x.test/api/survivor/challenge-board'
  it('401 signed out, 403 non-member, 400 bad input, 200 for a member', async () => {
    h.session = null
    expect((await boardGET(new NextRequest(`${URL_B}?leagueId=L1`))).status).toBe(401)
    h.session = { user: { id: 'u1' } }
    h.member = false
    expect((await boardGET(new NextRequest(`${URL_B}?leagueId=L1`))).status).toBe(403)
    expect((await post(boardPOST, URL_B, { leagueId: 'L1', challengeId: 'c1', answer: { optionId: 'yes' } })).status).toBe(403)
    h.member = true
    expect((await post(boardPOST, URL_B, { leagueId: 'L1', challengeId: 'c1' })).status).toBe(400)
    const ok = await post(boardPOST, URL_B, { leagueId: 'L1', challengeId: 'c1', answer: { optionId: 'yes' } })
    expect(ok.status).toBe(200)
    expect(h.builder.submitBuilderAnswer).toHaveBeenCalledWith('L1', 'u1', 'c1', { optionId: 'yes' })
  })

  it('passes the builder’s refusal through (first answer stands → 409)', async () => {
    h.session = { user: { id: 'u1' } }
    h.builder.submitBuilderAnswer.mockResolvedValue({ ok: false, status: 409, error: 'You already answered; the first answer stands.' })
    const res = await post(boardPOST, URL_B, { leagueId: 'L1', challengeId: 'c1', answer: { optionId: 'no' } })
    expect(res.status).toBe(409)
  })
})
