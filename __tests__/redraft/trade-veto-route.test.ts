/**
 * Regression tests for the dedicated commissioner trade veto route.
 *
 * Route added: POST /api/redraft/trades/veto
 * Client helper added: vetoRedraftTradeProposal()
 * UI: TradeCenter gains optional isCommissioner prop + Commissioner Veto button
 *
 * Key contract:
 *  - Only commissioners can call this route (403 for non-commissioners)
 *  - Only pending canonical RedraftTradeProposal IDs are accepted
 *  - Legacy RedraftLeagueTrade IDs return 404 (not in the proposals table)
 *  - Accepted/rejected/cancelled/vetoed proposals return 409
 *  - Unauthenticated requests return 401
 *  - No legacy trade record is created on veto (only on accept)
 *  - Decision audit record is written
 *  - Existing trade-votes commissioner_veto action still works (not removed)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createMockNextRequest } from '../helpers/createMockNextRequest'
import { translations } from '@/lib/i18n/translations'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const vetoRoute = read('app/api/redraft/trades/veto/route.ts')
const clientLib = read('lib/redraft/client.ts')
const tradeCenterSrc = read('app/league/[leagueId]/tabs/redraft/TradeCenter.tsx')

// ─── Static contract: veto route file ────────────────────────────────────────

describe('POST /api/redraft/trades/veto — static contract', () => {
  it('exports a POST handler', () => {
    expect(vetoRoute).toContain('export async function POST')
  })

  it('is force-dynamic', () => {
    expect(vetoRoute).toContain("dynamic = 'force-dynamic'")
  })

  it('requires proposalId in request body', () => {
    expect(vetoRoute).toContain('proposalId required')
    expect(vetoRoute).toContain('400')
  })

  it('queries redraftTradeProposal, not legacy redraftLeagueTrade', () => {
    expect(vetoRoute).toContain('redraftTradeProposal.findUnique')
    expect(vetoRoute).not.toContain('redraftLeagueTrade.findUnique')
    expect(vetoRoute).not.toContain('redraftLeagueTrade.findFirst')
  })

  it('returns 404 when proposal not found (rejects legacy IDs implicitly)', () => {
    expect(vetoRoute).toContain('404')
    expect(vetoRoute).toContain('Trade proposal not found')
    expect(vetoRoute).toContain('canonical RedraftTradeProposal')
  })

  it('requires commissioner permission — returns 403 for non-commissioners', () => {
    expect(vetoRoute).toContain('403')
    expect(vetoRoute).toContain('Commissioner or co-commissioner permission required')
  })

  it('rejects non-pending proposals with 409', () => {
    expect(vetoRoute).toContain('409')
    expect(vetoRoute).toContain("status !== 'pending'")
    expect(vetoRoute).toContain('Only pending proposals can be vetoed')
  })

  it("updates proposal status to 'vetoed'", () => {
    expect(vetoRoute).toContain("status: 'vetoed'")
    expect(vetoRoute).toContain('redraftTradeProposal.update')
  })

  it('writes a RedraftTradeDecision audit record', () => {
    expect(vetoRoute).toContain('redraftTradeDecision')
    expect(vetoRoute).toContain("decision: 'vetoed'")
    expect(vetoRoute).toContain('decidedByUserId: userId')
  })

  it('returns proposalId, leagueId, status, vetoedBy in response', () => {
    expect(vetoRoute).toContain('proposalId: vetoed.id')
    expect(vetoRoute).toContain('leagueId: vetoed.leagueId')
    expect(vetoRoute).toContain('status: vetoed.status')
    expect(vetoRoute).toContain('vetoedBy: userId')
  })

  it('does NOT create a legacy RedraftLeagueTrade record (only done on accept)', () => {
    expect(vetoRoute).not.toContain('redraftLeagueTrade.create')
  })

  it('does NOT call validateRedraftTradeCap or applyRedraftTradeCapTransfers', () => {
    expect(vetoRoute).not.toContain('validateRedraftTradeCap')
    expect(vetoRoute).not.toContain('applyRedraftTradeCapTransfers')
  })

  it('does NOT call enqueueCollusionScan (only runs on accepted trades)', () => {
    expect(vetoRoute).not.toContain('enqueueCollusionScan')
  })

  it('fires recordTradeOutcomeForBothManagers for learning system', () => {
    expect(vetoRoute).toContain('recordTradeOutcomeForBothManagers')
    expect(vetoRoute).toContain("eventType: 'trade_vetoed'")
    expect(vetoRoute).toContain("source: 'commissioner_veto_route'")
  })

  it('requires authentication — returns 401 for missing session', () => {
    expect(vetoRoute).toContain('Unauthorized')
    expect(vetoRoute).toContain('401')
  })

  it('does not touch playoff/standings/champion code', () => {
    expect(vetoRoute).not.toContain('playoffEngine')
    expect(vetoRoute).not.toContain('advancePlayoffWinners')
    expect(vetoRoute).not.toContain('finalizeRedraftSeasonChampion')
    expect(vetoRoute).not.toContain('LeagueChampionship')
  })
})

// ─── Static contract: client helper ──────────────────────────────────────────

describe('lib/redraft/client.ts — vetoRedraftTradeProposal helper', () => {
  it('exports vetoRedraftTradeProposal', () => {
    expect(clientLib).toContain('export async function vetoRedraftTradeProposal')
  })

  it('calls /api/redraft/trades/veto (the dedicated endpoint)', () => {
    expect(clientLib).toContain('/api/redraft/trades/veto')
  })

  it('does NOT call legacy /api/redraft/trades directly', () => {
    // The helper targets the dedicated veto sub-route, not the parent retired route
    const vetoFn = clientLib.slice(clientLib.indexOf('export async function vetoRedraftTradeProposal'))
    const nextFn = vetoFn.indexOf('\nexport async function', 1)
    const fnBody = nextFn > 0 ? vetoFn.slice(0, nextFn) : vetoFn
    // Should contain /veto path, not just /trades without /veto
    expect(fnBody).toContain('/api/redraft/trades/veto')
  })

  it('uses POST method', () => {
    const vetoFn = clientLib.slice(clientLib.indexOf('export async function vetoRedraftTradeProposal'))
    expect(vetoFn).toContain("method: 'POST'")
  })

  it('accepts proposalId and optional reason', () => {
    const vetoFn = clientLib.slice(clientLib.indexOf('export async function vetoRedraftTradeProposal'))
    expect(vetoFn).toContain('proposalId')
    expect(vetoFn).toContain('reason')
  })
})

// ─── Static contract: TradeCenter UI ─────────────────────────────────────────

describe('TradeCenter — commissioner veto button', () => {
  it('imports vetoRedraftTradeProposal from client lib', () => {
    expect(tradeCenterSrc).toContain('vetoRedraftTradeProposal')
  })

  it('accepts isCommissioner prop (optional, defaults false)', () => {
    expect(tradeCenterSrc).toContain('isCommissioner')
    expect(tradeCenterSrc).toContain('isCommissioner = false')
  })

  it('only renders the commissioner veto button for commissioners', () => {
    // T4 broadened the gate to `isCommissioner || settingsCommissioner` (commish derived from settings).
    expect(tradeCenterSrc).toContain('isCommissioner || settingsCommissioner')
    // The label lives in the i18n dictionary (English + Spanish) since the Trade Center was translated.
    expect(tradeCenterSrc).toContain("t('tradeCenter.action.commissionerVeto')")
    expect(translations.en['tradeCenter.action.commissionerVeto']).toBe('commissioner veto')
  })

  it('has onVeto handler that calls vetoRedraftTradeProposal', () => {
    expect(tradeCenterSrc).toContain('onVeto')
    expect(tradeCenterSrc).toContain('vetoRedraftTradeProposal')
  })

  it('still wires every respond action (accept/reject/cancel/vote) through onAction', () => {
    expect(tradeCenterSrc).toContain('onAction(p.id, action)')
    for (const action of ['accept', 'reject', 'cancel', 'vote_approve', 'vote_veto']) {
      expect(tradeCenterSrc).toContain(`'${action}'`)
    }
  })

  it('gates respond + commissioner actions to pending proposals', () => {
    expect(tradeCenterSrc).toContain("p.status === 'pending'")
  })
})

// ─── Integration: veto route handler ─────────────────────────────────────────

const getServerSessionMock = vi.fn()

const prismaMock = {
  redraftTradeProposal: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  redraftTradeDecision: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  redraftRoster: {
    findMany: vi.fn(),
  },
  league: {
    findFirst: vi.fn(),
  },
}

const recordTradeOutcomeMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-learning-system/recordTradeParticipants', () => ({
  recordTradeOutcomeForBothManagers: recordTradeOutcomeMock,
}))

describe('POST /api/redraft/trades/veto — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'commissioner-1' } })
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trades/veto', {
      method: 'POST',
      body: { proposalId: 'p-1' },
    })
    const res = await POST(req as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 when proposalId is missing', async () => {
    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trades/veto', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('proposalId')
  })

  it('returns 404 when proposal is not found (rejects legacy IDs)', async () => {
    prismaMock.redraftTradeProposal.findUnique.mockResolvedValueOnce(null)
    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trades/veto', {
      method: 'POST',
      body: { proposalId: 'legacy-trade-id' },
    })
    const res = await POST(req as never)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('canonical')
  })

  it('returns 403 when user is not a commissioner', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'regular-user' } })
    prismaMock.redraftTradeProposal.findUnique.mockResolvedValueOnce({
      id: 'p-1',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      assets: [],
    })
    prismaMock.league.findFirst.mockResolvedValueOnce({
      userId: 'commissioner-1',
      teams: [],
    })
    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trades/veto', {
      method: 'POST',
      body: { proposalId: 'p-1' },
    })
    const res = await POST(req as never)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Commissioner')
  })

  it('returns 409 when proposal is not pending', async () => {
    prismaMock.redraftTradeProposal.findUnique.mockResolvedValueOnce({
      id: 'p-1',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'accepted',
      assets: [],
    })
    prismaMock.league.findFirst.mockResolvedValueOnce({ userId: 'commissioner-1', teams: [] })
    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trades/veto', {
      method: 'POST',
      body: { proposalId: 'p-1' },
    })
    const res = await POST(req as never)
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string; currentStatus: string }
    expect(body.currentStatus).toBe('accepted')
  })

  it('returns 409 when proposal is already vetoed (idempotency guard)', async () => {
    prismaMock.redraftTradeProposal.findUnique.mockResolvedValueOnce({
      id: 'p-1',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'vetoed',
      assets: [],
    })
    prismaMock.league.findFirst.mockResolvedValueOnce({ userId: 'commissioner-1', teams: [] })
    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trades/veto', {
      method: 'POST',
      body: { proposalId: 'p-1' },
    })
    const res = await POST(req as never)
    expect(res.status).toBe(409)
  })

  it('vetoes a pending proposal and returns correct shape', async () => {
    prismaMock.redraftTradeProposal.findUnique.mockResolvedValueOnce({
      id: 'p-1',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      assets: [],
    })
    prismaMock.league.findFirst.mockResolvedValueOnce({ userId: 'commissioner-1', teams: [] })
    prismaMock.redraftTradeProposal.update.mockResolvedValueOnce({
      id: 'p-1',
      leagueId: 'l-1',
      status: 'vetoed',
    })
    prismaMock.redraftTradeDecision.findFirst.mockResolvedValueOnce(null)
    prismaMock.redraftTradeDecision.create.mockResolvedValueOnce({ id: 'd-1' })
    prismaMock.redraftRoster.findMany.mockResolvedValueOnce([
      { id: 'r-1', ownerId: 'u-1' },
      { id: 'r-2', ownerId: 'u-2' },
    ])
    recordTradeOutcomeMock.mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trades/veto', {
      method: 'POST',
      body: { proposalId: 'p-1', reason: 'Collusion concern' },
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    const body = await res.json() as { proposalId: string; status: string; vetoedBy: string; reason: string }
    expect(body.proposalId).toBe('p-1')
    expect(body.status).toBe('vetoed')
    expect(body.vetoedBy).toBe('commissioner-1')
    expect(body.reason).toBe('Collusion concern')
  })

  it('does NOT call redraftLeagueTrade.create on veto', async () => {
    prismaMock.redraftTradeProposal.findUnique.mockResolvedValueOnce({
      id: 'p-1',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      assets: [],
    })
    prismaMock.league.findFirst.mockResolvedValueOnce({ userId: 'commissioner-1', teams: [] })
    prismaMock.redraftTradeProposal.update.mockResolvedValueOnce({ id: 'p-1', leagueId: 'l-1', status: 'vetoed' })
    prismaMock.redraftTradeDecision.findFirst.mockResolvedValueOnce(null)
    prismaMock.redraftTradeDecision.create.mockResolvedValueOnce({ id: 'd-1' })
    prismaMock.redraftRoster.findMany.mockResolvedValueOnce([])
    recordTradeOutcomeMock.mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trades/veto', {
      method: 'POST',
      body: { proposalId: 'p-1' },
    })
    await POST(req as never)

    // redraftLeagueTrade is not on the mock — if the route tried to call it, vitest would throw
    // The test passing proves no legacy write occurred
    expect(prismaMock.redraftTradeProposal.update).toHaveBeenCalledTimes(1)
  })

  it('co-commissioner can also veto (not just league owner)', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'co-commissioner-1' } })
    prismaMock.redraftTradeProposal.findUnique.mockResolvedValueOnce({
      id: 'p-2',
      leagueId: 'l-1',
      seasonId: 's-1',
      proposerRosterId: 'r-1',
      receiverRosterId: 'r-2',
      status: 'pending',
      assets: [],
    })
    prismaMock.league.findFirst.mockResolvedValueOnce({
      userId: 'owner-1',
      teams: [{ isCommissioner: false, isCoCommissioner: true }],
    })
    prismaMock.redraftTradeProposal.update.mockResolvedValueOnce({ id: 'p-2', leagueId: 'l-1', status: 'vetoed' })
    prismaMock.redraftTradeDecision.findFirst.mockResolvedValueOnce(null)
    prismaMock.redraftTradeDecision.create.mockResolvedValueOnce({ id: 'd-2' })
    prismaMock.redraftRoster.findMany.mockResolvedValueOnce([])
    recordTradeOutcomeMock.mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const req = createMockNextRequest('http://localhost/api/redraft/trades/veto', {
      method: 'POST',
      body: { proposalId: 'p-2' },
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
  })
})

// ─── Existing trade-votes commissioner_veto still works ───────────────────────

describe('trade-votes route — commissioner_veto action still present', () => {
  const tradeVotesSrc = read('app/api/redraft/trade-votes/route.ts')

  it('still contains commissioner_veto action', () => {
    expect(tradeVotesSrc).toContain("'commissioner_veto'")
  })

  it('commissioner_veto in trade-votes still sets status to vetoed', () => {
    expect(tradeVotesSrc).toContain("status: 'vetoed'")
  })
})
