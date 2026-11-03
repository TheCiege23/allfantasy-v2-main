// @vitest-environment node
/**
 * Routes for Survivor governance: the commissioner actions on /api/survivor/commissioner
 * (commissioner allowed, everyone else 403, bad input 400) and the castaway view and alliance
 * actions on /api/survivor/governance (members only).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'commish' } } as { user: { id: string } } | null,
  commissioner: true,
  member: true,
  db: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorPlayer: { findUnique: vi.fn(), findMany: vi.fn() },
    survivorTribe: { count: vi.fn() },
    survivorCommissionerAction: { create: vi.fn() },
  },
  issue: vi.fn(),
  revoke: vi.fn(),
  strikes: vi.fn(),
  createAlliance: vi.fn(),
  leave: vi.fn(),
  list: vi.fn(),
  seal: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerRole: async () => { if (!h.commissioner) throw new Response('Forbidden', { status: 403 }) },
}))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: async () => (h.member ? { ok: true } : { ok: false, status: 403 }) }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: async () => null }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: vi.fn() }))
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorTribeShuffleEngine', () => ({ runShuffle: vi.fn() }))
vi.mock('@/lib/survivor/survivorTribalOverride', () => ({ overrideTribalResult: vi.fn(), readTribalOverrideTarget: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueNotification: vi.fn() }))
vi.mock('@/lib/survivor/survivorCouncilPause', () => ({ setCouncilPaused: vi.fn() }))
vi.mock('@/lib/survivor/survivorRemovePlayer', () => ({ removeSurvivorPlayer: vi.fn() }))
vi.mock('@/lib/survivor/survivorConductService', () => ({ issueSurvivorConductStrike: h.issue, revokeSurvivorConductStrike: h.revoke, listSurvivorConductStrikes: h.strikes }))
vi.mock('@/lib/survivor/survivorScheduledSwaps', () => ({ sealCommissionerTribeSwap: h.seal }))
vi.mock('@/lib/survivor/survivorExperienceService', () => ({ loadCastawayExperience: vi.fn(async () => ({})) }))
vi.mock('@/lib/survivor/survivorAlliances', () => ({ createSurvivorAlliance: h.createAlliance, leaveSurvivorAlliance: h.leave, listSurvivorAlliances: h.list }))

import { POST as commissionerPOST } from '@/app/api/survivor/commissioner/route'
import { GET as governanceGET, POST as governancePOST } from '@/app/api/survivor/governance/route'

const post = (handler: (req: never) => Promise<Response>, body: object) => handler(new Request('https://example.test/api', { method: 'POST', body: JSON.stringify({ leagueId: 'L1', ...body }) }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  h.session = { user: { id: 'commish' } }
  h.commissioner = true
  h.member = true
  h.db.league.findUnique.mockResolvedValue({ settings: {}, survivorSwapWeek: null, survivorMode: true })
  h.db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 0, mergeTriggeredAt: null, phase: 'pre_draft' })
  h.db.survivorTribe.count.mockResolvedValue(0)
  h.db.survivorPlayer.findUnique.mockResolvedValue({ id: 'sp1', playerState: 'active', tribeId: 't1' })
  h.db.survivorPlayer.findMany.mockResolvedValue([])
  h.strikes.mockResolvedValue([])
  h.list.mockResolvedValue([])
})

describe('/api/survivor/commissioner governance actions', () => {
  it('saves valid settings for the commissioner and logs the change', async () => {
    const res = await post(commissionerPOST, { action: 'governance_settings', settings: { alliancesEnabled: true, tradeRulesEnabled: true, crossTribeTrades: 'banned' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settings).toMatchObject({ alliancesEnabled: true, tradeRulesEnabled: true, crossTribeTrades: 'banned' })
    expect(h.db.league.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { settings: expect.objectContaining({ survivorGovernance: expect.objectContaining({ alliancesEnabled: true }) }) } })
    expect(h.db.survivorCommissionerAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionType: 'governance_settings' }) })
  })

  it('refuses a non-commissioner with 403 before reading anything', async () => {
    h.commissioner = false
    const res = await post(commissionerPOST, { action: 'governance_settings', settings: { alliancesEnabled: true } })
    expect(res.status).toBe(403)
    expect(h.db.league.update).not.toHaveBeenCalled()
    expect((await post(commissionerPOST, { action: 'issue_strike', userId: 'u1', reason: 'Spam spam' })).status).toBe(403)
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('bad input is a 400; a locked setting is a 409', async () => {
    expect((await post(commissionerPOST, { action: 'governance_settings', settings: { allianceMaxSize: 'lots' } })).status).toBe(400)
    expect((await post(commissionerPOST, { action: 'governance_settings', settings: {} })).status).toBe(400)
    expect((await post(commissionerPOST, { action: 'issue_strike', reason: 'no user' })).status).toBe(400)
    expect((await post(commissionerPOST, { action: 'set_experience', userId: 'u1', experience: 'legend' })).status).toBe(400)
    expect((await post(commissionerPOST, { action: 'swap_now', swap: { mode: 'resize' } })).status).toBe(400)
    h.db.survivorTribe.count.mockResolvedValue(4)
    expect((await post(commissionerPOST, { action: 'governance_settings', settings: { tribeSplit: 'rooks_vs_vets' } })).status).toBe(409)
  })

  it('issues a strike and seals a swap through the services', async () => {
    h.issue.mockResolvedValue({ ok: true, strikeId: 's1', activeStrikes: 1, limit: 2, limitReached: false, removed: false })
    const res = await post(commissionerPOST, { action: 'issue_strike', userId: 'u1', reason: 'Harassment' })
    expect(res.status).toBe(200)
    expect(h.issue).toHaveBeenCalledWith('L1', { targetUserId: 'u1', reason: 'Harassment', actorUserId: 'commish' })
    h.seal.mockResolvedValue({ ok: true, swapId: 'sw1', revealAt: '2026-11-06T00:15:00.000Z' })
    const swap = await post(commissionerPOST, { action: 'swap_now', swap: { mode: 'resize', tribeCount: 3 } })
    expect(swap.status).toBe(200)
    expect(h.seal).toHaveBeenCalledWith('L1', { week: 1, mode: 'resize', tribeCount: 3 }, 'commish')
  })
})

describe('/api/survivor/governance', () => {
  const get = () => governanceGET({ nextUrl: new URL('https://example.test/api/survivor/governance?leagueId=L1') } as never)

  it('a member sees the rules and only their own strikes', async () => {
    h.session = { user: { id: 'u1' } }
    h.strikes.mockResolvedValue([{ id: 's1', userId: 'u1', reason: 'Spam', week: 2, issuedAt: '2026-10-01T00:00:00.000Z' }])
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(h.strikes).toHaveBeenCalledWith('L1', 'u1')
    expect(body.myStrikes).toHaveLength(1)
    expect(body.rules).toMatchObject({ alliancesEnabled: false, tradeRulesEnabled: false, strikeLimit: 2 })
  })

  it('a non-member gets 403', async () => {
    h.member = false
    expect((await get()).status).toBe(403)
    expect((await post(governancePOST, { action: 'alliance_create', name: 'X', memberUserIds: ['u2'] })).status).toBe(403)
    expect(h.createAlliance).not.toHaveBeenCalled()
  })

  it('bad alliance input is a 400, a refused alliance carries its reason', async () => {
    h.session = { user: { id: 'u1' } }
    expect((await post(governancePOST, { action: 'alliance_create', name: 'X', memberUserIds: 'u2' })).status).toBe(400)
    expect((await post(governancePOST, { action: 'alliance_leave' })).status).toBe(400)
    expect((await post(governancePOST, { action: 'nope' })).status).toBe(400)
    h.createAlliance.mockResolvedValue({ ok: false, code: 'disabled', error: 'Alliance chats are turned off in this league.' })
    const refused = await post(governancePOST, { action: 'alliance_create', name: 'Core', memberUserIds: ['u2'] })
    expect(refused.status).toBe(403)
    h.createAlliance.mockResolvedValue({ ok: true, channelId: 'ch1', name: 'Core', memberUserIds: ['u1', 'u2'] })
    expect((await post(governancePOST, { action: 'alliance_create', name: 'Core', memberUserIds: ['u2'] })).status).toBe(200)
  })

  it('requires a session', async () => {
    h.session = null
    expect((await get()).status).toBe(401)
  })
})
