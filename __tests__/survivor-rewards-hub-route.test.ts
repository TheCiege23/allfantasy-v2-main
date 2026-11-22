// @vitest-environment node
/**
 * Survivor gaps (G2) — the Commissioner Hub reward routes: the rewards panel's cast list
 * (`type=reward_cast`, commissioner only), and `grant_reward` applying the league's per-phase prize
 * rules on the server (400 with a clear EN/ES reason; penalties never restricted; defaults = today).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const s = {
    session: { user: { id: 'commish' } } as { user?: { id?: string } } | null,
    commissioner: true,
    settings: {} as Record<string, unknown>,
    language: 'en',
    game: { currentWeek: 8, phase: 'post_merge', mergeTriggeredAt: new Date('2026-10-20T00:00:00Z') } as Record<string, unknown> | null,
    apply: vi.fn(),
    db: {} as Record<string, unknown>,
  }
  s.db = {
    survivorCommissionerAction: { create: vi.fn() },
    league: { findUnique: vi.fn(async () => ({ settings: s.settings, language: s.language })) },
    survivorGameState: { findUnique: vi.fn(async () => s.game) },
    survivorPlayer: { findMany: vi.fn(async () => [
      { redraftRosterId: 'r2', displayName: 'Ben', tribeId: 'm', playerState: 'active' },
      { redraftRosterId: 'r1', displayName: 'Ana', tribeId: 'm', playerState: 'active' },
      { redraftRosterId: null, displayName: 'Ghost', tribeId: null, playerState: 'active' },
    ]) },
    survivorTribe: { findMany: vi.fn(async () => [{ id: 'm', name: 'Merged' }]) },
  }
  return s
})
vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerRole: async () => {
    if (!h.commissioner) throw new Response('Forbidden', { status: 403 })
  },
}))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: async () => null }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: vi.fn() }))
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueNotification: vi.fn() }))
vi.mock('@/lib/survivor/survivorCouncilPause', () => ({ setCouncilPaused: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({
  applySurvivorReward: h.apply,
  chooseSurvivorRewardTarget: vi.fn(),
  reverseSurvivorReward: vi.fn(),
  listSurvivorRewards: vi.fn(async () => []),
}))

import { GET, POST } from '@/app/api/survivor/commissioner/route'
import { NextRequest } from 'next/server'

const url = 'https://x.test/api/survivor/commissioner'
const post = (body: object) => POST(new Request(url, { method: 'POST', body: JSON.stringify(body) }) as never)
const grant = (reward: object) => post({ leagueId: 'L1', action: 'grant_reward', requestId: 'req', week: 8, reward })

beforeEach(() => {
  vi.clearAllMocks()
  h.session = { user: { id: 'commish' } }
  h.commissioner = true
  h.settings = {}
  h.language = 'en'
  h.game = { currentWeek: 8, phase: 'post_merge', mergeTriggeredAt: new Date('2026-10-20T00:00:00Z') }
  h.apply.mockResolvedValue({ ok: true, rewardId: 'k', status: 'applied', duplicate: false, changes: [], note: null })
})

describe('GET type=reward_cast', () => {
  it('gives the commissioner the cast, tribes, week, phase and allowed prize types', async () => {
    const res = await GET(new NextRequest(`${url}?leagueId=L1&type=reward_cast`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cast).toEqual([{ rosterId: 'r1', name: 'Ana', tribeId: 'm', state: 'active' }, { rosterId: 'r2', name: 'Ben', tribeId: 'm', state: 'active' }])
    expect(body).toMatchObject({ currentWeek: 8, phase: 'post_merge', tribes: [{ id: 'm', name: 'Merged' }] })
    expect(body.allowedPrizeTypes).not.toContain('faab_transfer')
  })
  it('is commissioner only (403) and needs a league (400)', async () => {
    h.commissioner = false
    expect((await GET(new NextRequest(`${url}?leagueId=L1&type=reward_cast`))).status).toBe(403)
    h.commissioner = true
    expect((await GET(new NextRequest(`${url}?type=reward_cast`))).status).toBe(400)
  })
})

describe('grant_reward and the per-phase prize rules', () => {
  it('defaults: a points prize after the merge is fine (today’s behaviour)', async () => {
    expect((await grant({ type: 'score_bonus', rosterId: 'r1', points: 10 })).status).toBe(200)
    expect(h.apply).toHaveBeenCalledTimes(1)
  })
  it('defaults: a tribe FAAB transfer after the merge is refused before the reward API runs', async () => {
    const res = await grant({ type: 'faab_transfer', fromTribeId: 'a', toTribeId: 'b', amount: 5 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'FAAB from the other tribes cannot be given as a prize after the merge (league prize rules).', code: 'phase_type' })
    expect(h.apply).not.toHaveBeenCalled()
  })
  it('the commissioner’s rules: a steal not allowed after the merge is refused in Spanish; a penalty never is', async () => {
    h.settings = { survivorPrizePhaseRules: { post_merge: ['score_bonus'] } }
    h.language = 'es'
    const res = await grant({ type: 'steal', thiefRosterId: 'r1', what: 'faab', amount: 5 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Un robo no se puede dar como premio después de la fusión (reglas de premios de la liga).')
    expect((await grant({ type: 'score_penalty', rosterId: 'r1', points: 5 })).status).toBe(200)
    expect(h.apply).toHaveBeenCalledTimes(1)
  })
  it('non-commissioners get 403 and nothing is paid', async () => {
    h.commissioner = false
    expect((await grant({ type: 'score_bonus', rosterId: 'r1', points: 10 })).status).toBe(403)
    expect(h.apply).not.toHaveBeenCalled()
  })
})
