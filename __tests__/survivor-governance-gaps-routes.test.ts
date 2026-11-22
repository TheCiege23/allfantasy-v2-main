// @vitest-environment node
/**
 * Routes for the G4 governance settings — several cross-tribe windows a week, "if the check can't
 * run" and the cross-league Rooks vs Vets lookup: commissioner allowed, everyone else 403, bad input
 * 400, and the castaway view carries the windows. Same mocks as survivor-governance-routes.test.ts.
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

const windows = [
  { opensOn: 'tribal', closeDay: 'Thursday', closeTime: '20:15' },
  { opensOn: 'time', openDay: 'Friday', openTime: '00:00', closeDay: 'Sunday', closeTime: '13:00' },
]

describe('/api/survivor/commissioner governance_settings — G4 settings', () => {
  it('the commissioner saves two windows, the hold mode and the cross-league lookup', async () => {
    const res = await post(commissionerPOST, { action: 'governance_settings', settings: { tradeRulesEnabled: true, crossTribeWindows: windows, tradeCheckFailureMode: 'hold', experienceCrossLeague: true } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settings).toMatchObject({ crossTribeWindows: windows, crossTribeCloseDay: 'Thursday', crossTribeCloseTime: '20:15', tradeCheckFailureMode: 'hold', experienceCrossLeague: true })
    expect(h.db.league.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { settings: expect.objectContaining({ survivorGovernance: expect.objectContaining({ crossTribeWindows: windows, tradeCheckFailureMode: 'hold' }) }) } })
  })

  it('a non-commissioner gets 403 and nothing is written', async () => {
    h.commissioner = false
    const res = await post(commissionerPOST, { action: 'governance_settings', settings: { crossTribeWindows: windows } })
    expect(res.status).toBe(403)
    expect(h.db.league.update).not.toHaveBeenCalled()
  })

  it('bad windows, a bad failure mode or a bad flag are 400', async () => {
    const bad = async (settings: object) => (await post(commissionerPOST, { action: 'governance_settings', settings })).status
    expect(await bad({ crossTribeWindows: [] })).toBe(400)
    expect(await bad({ crossTribeWindows: [...windows, ...windows] })).toBe(400)
    expect(await bad({ crossTribeWindows: [{ opensOn: 'time', closeDay: 'Sunday', closeTime: '13:00' }] })).toBe(400)
    expect(await bad({ tradeCheckFailureMode: 'refuse' })).toBe(400)
    expect(await bad({ experienceCrossLeague: 1 })).toBe(400)
    expect(h.db.league.update).not.toHaveBeenCalled()
  })
})

describe('/api/survivor/governance — the castaway view', () => {
  it('carries every window and names which one is open', async () => {
    h.session = { user: { id: 'u1' } }
    h.db.league.findUnique.mockResolvedValue({ survivorMode: true, settings: { tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00', survivorGovernance: { tradeRulesEnabled: true, crossTribeWindows: windows } } })
    const res = await governanceGET({ nextUrl: new URL('https://example.test/api/survivor/governance?leagueId=L1') } as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rules.crossTribeWindows).toEqual(windows)
    expect(body.rules.tradeCheckFailureMode).toBe('allow')
    expect(body.tradeWindow).toHaveProperty('crossTribeWindow')
    expect(body.tradeWindow).toHaveProperty('crossTribeOpensAt')
  })
})
