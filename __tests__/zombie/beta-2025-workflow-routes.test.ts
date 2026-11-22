// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: vi.fn(), gate: vi.fn(), z: vi.fn(), rows: vi.fn(), owner: vi.fn(),
  start: vi.fn(), respond: vi.fn(), preview: vi.fn(), execute: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: h.gate }))
vi.mock('@/lib/prisma', () => ({ prisma: { zombieLeague: { findUnique: h.z }, zombieRoleWorkflow: { findMany: h.rows }, league: { findUnique: h.owner } } }))
vi.mock('@/lib/zombie/beta2025RoleWorkflows', () => ({ startBetaWhispererOffers: h.start, respondBetaRoleWorkflow: h.respond, reviewBetaVeterans: vi.fn() }))
vi.mock('@/lib/zombie/beta2025Ambush', () => ({ previewBetaAmbush: h.preview, executeBetaAmbush: h.execute }))
import * as roles from '@/app/api/zombie/role-workflows/route'
import * as ambush from '@/app/api/zombie/ambush/route'

const get = () => new Request('http://localhost/api/zombie/role-workflows?leagueId=L')
const post = (body: object) => new Request('http://localhost/api/zombie/role-workflows', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'manager' } }); h.gate.mockResolvedValue({ ok: true })
  h.z.mockResolvedValue({ id: 'Z', sport: 'NFL', status: 'active', league: { userId: 'owner' }, whispererRecord: null })
  h.rows.mockResolvedValue([]); h.owner.mockResolvedValue({ userId: 'owner' })
  h.start.mockResolvedValue({ workflowId: 'offer', status: 'pending' }); h.respond.mockResolvedValue({ ok: true })
  h.preview.mockResolvedValue({ matches: [] }); h.execute.mockResolvedValue({ actionId: 'receipt' })
})
describe('2025 workflow access and privacy', () => {
  it.each([roles.GET, ambush.GET])('requires a session before reading any league', async handler => {
    h.session.mockResolvedValue(null)
    expect((await handler(get())).status).toBe(401)
    expect(h.gate).not.toHaveBeenCalled(); expect(h.z).not.toHaveBeenCalled(); expect(h.preview).not.toHaveBeenCalled()
  })
  it.each([roles.GET, ambush.GET])('rejects outsiders before querying private state', async handler => {
    h.gate.mockResolvedValue({ ok: false })
    expect((await handler(get())).status).toBe(403)
    expect(h.z).not.toHaveBeenCalled(); expect(h.preview).not.toHaveBeenCalled()
  })
  it('limits member queries to their own choices and strips secret state', async () => {
    h.rows.mockResolvedValue([{ id: 'offer', actorUserId: 'manager', targetUserId: 'hidden-target', kind: 'initial_offer', status: 'pending',
      deadlineAt: new Date(), state: { index: 2, candidates: [{ userId: 'hidden-candidate' }], remaining: 2 } }])
    const response = await roles.GET(get()), text = await response.text()
    expect(h.rows).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ actorUserId: 'manager', zombieLeagueId: 'Z' }) }))
    expect(JSON.parse(text).workflows[0]).toMatchObject({ offerIndex: 2, canRespond: true })
    for (const secret of ['hidden-target', 'hidden-candidate', 'candidates', 'remaining', 'state']) expect(text).not.toContain(secret)
  })
  it('does not expose a nominee list or another manager offer index to the owner', async () => {
    h.session.mockResolvedValue({ user: { id: 'owner' } })
    h.rows.mockResolvedValue([{ id: 'offer', actorUserId: 'manager', kind: 'initial_offer', status: 'pending', state: { index: 2 } }])
    const body = await (await roles.GET(get())).json()
    expect(body.workflows[0]).not.toHaveProperty('offerIndex'); expect(body.nominees).toEqual([])
    expect(body.workflows[0].canRespond).toBe(false)
  })
  it.each(['start', 'nominate'])('requires ownership for %s', async action => {
    expect((await roles.POST(post({ leagueId: 'L', action, nomineeId: 'other', reason: 'reviewed' }))).status).toBe(403)
    expect(h.start).not.toHaveBeenCalled()
  })
  it('passes the session actor and reviewed offer index, never a client supplied actor', async () => {
    expect((await roles.POST(post({ leagueId: 'L', workflowId: 'offer', decision: 'accept', offerIndex: 2, userId: 'owner' }))).status).toBe(200)
    expect(h.respond).toHaveBeenCalledWith('L', 'offer', 'manager', 'accept', 2)
  })
  it('returns a conflict when the service rejects a cross-league decision', async () => {
    h.respond.mockRejectedValue(new Error('This decision belongs to another manager or league.'))
    expect((await roles.POST(post({ leagueId: 'L', workflowId: 'foreign-choice', decision: 'infect' }))).status).toBe(409)
  })
  it('validates a complete ambush request before execution', async () => {
    expect((await ambush.POST(post({ leagueId: 'L', pairs: [] }))).status).toBe(400)
    expect(h.execute).not.toHaveBeenCalled()
  })
  it('denies a nonmember ambush before executing anything', async () => {
    h.gate.mockResolvedValue({ ok: false })
    expect((await ambush.POST(post({ leagueId: 'L', requestId: 'receipt', previewHash: 'hash', week: 1, pairs: [] }))).status).toBe(403)
    expect(h.execute).not.toHaveBeenCalled()
  })
})
