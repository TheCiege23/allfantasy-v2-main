// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), gate: vi.fn(), role: vi.fn(), create: vi.fn(), row: vi.fn(), audit: vi.fn(), update: vi.fn(), reconcile: vi.fn(), read: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: m.gate, isCommissioner: m.role }))
vi.mock('@/lib/commissioner-workspace/taskStore', () => ({ reconcileLeagueTasks: m.reconcile, readLeagueTasks: m.read }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn({ commissionerWorkspaceTask: { createMany: m.create, findFirst: m.row, updateMany: m.update }, leagueAuditLog: { create: m.audit } }) } }))
import { GET, POST, PATCH } from '@/app/api/core/commissioner-queue/route'
const body = { requestId: '0123456789abcdef', title: 'Review scoring', description: 'Reviewed task', dueAt: null }
const req = (method: string, value: unknown = body) => new Request('http://localhost/api/core/commissioner-queue?league=A', { method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }) })
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue({ user: { id: 'user' } }); m.gate.mockResolvedValue({}); m.role.mockResolvedValue(true); m.create.mockResolvedValue({ count: 1 }); m.row.mockResolvedValue({ id: 'task' }); m.audit.mockResolvedValue({}); m.update.mockResolvedValue({ count: 1 }); m.read.mockResolvedValue([]) })
describe('league-scoped weekly tasks', () => {
  it('refuses unauthenticated and non-commissioner writes before touching tasks', async () => {
    m.session.mockResolvedValue(null); expect((await POST(req('POST'))).status).toBe(401)
    m.session.mockResolvedValue({ user: { id: 'user' } }); m.gate.mockRejectedValue(new Error('Forbidden')); expect((await POST(req('POST'))).status).toBe(403)
    expect(m.create).not.toHaveBeenCalled()
  })
  it('rechecks commissioner permission inside the write transaction', async () => {
    m.role.mockResolvedValue(false); expect((await POST(req('POST'))).status).toBe(403)
    expect(m.create).not.toHaveBeenCalled()
  })
  it('creates a scoped task and audit, with retry duplication suppressed', async () => {
    expect((await POST(req('POST'))).status).toBe(200)
    expect(m.create.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ leagueId: 'A', sourceKey: `weekly:task:${body.requestId}`, title: body.title }] })
    expect(m.audit).toHaveBeenCalledTimes(1)
    m.create.mockResolvedValue({ count: 0 }); expect((await POST(req('POST'))).status).toBe(200)
    expect(m.audit).toHaveBeenCalledTimes(1)
  })
  it('rejects null bodies and invalid task content', async () => {
    expect((await POST(req('POST', null))).status).toBe(400)
    expect((await POST(req('POST', { ...body, title: '' }))).status).toBe(400)
    expect(m.create).not.toHaveBeenCalled()
  })
  it('includes manual weekly tasks while excluding other namespaces', async () => {
    m.read.mockResolvedValue([{ sourceKey: 'weekly:task:1' }, { sourceKey: 'operational:lineup:1' }, { sourceKey: 'unrelated:1' }])
    expect((await (await GET(req('GET'))).json()).tasks).toHaveLength(2)
  })
  it('supports waiting on a vote and rejects concurrent edits without writing an audit', async () => {
    const patch = { id: 'task', expectedStatus: 'open', expectedUpdatedAt: '2026-10-07T12:00:00Z', status: 'waiting_on_league_vote' }
    expect((await PATCH(req('PATCH', patch))).status).toBe(200)
    expect(m.update.mock.calls[0][0].where).toMatchObject({ leagueId: 'A', status: 'open', updatedAt: new Date(patch.expectedUpdatedAt) })
    m.update.mockResolvedValue({ count: 0 }); expect((await PATCH(req('PATCH', patch))).status).toBe(409)
    expect(m.audit).toHaveBeenCalledTimes(1)
  })
})

describe('weekly issue traceability',()=>{it('stores an exact-league issue link and rejects foreign issue IDs',async()=>{expect((await POST(req('POST',{...body,issueId:'B:lineup'}))).status).toBe(400);expect(m.create).not.toHaveBeenCalled();expect((await POST(req('POST',{...body,issueId:'A:lineup'}))).status).toBe(200);expect(m.create.mock.calls[0][0].data[0].relatedLinks[0].href).toBe('/core/week?league=A#weekly-issue-A%3Alineup')})})

describe('weekly task permission revocation',()=>{it('rechecks permission before a status update and leaves the audit untouched',async()=>{m.role.mockResolvedValue(false);const patch={id:'task',expectedStatus:'open',expectedUpdatedAt:'2026-10-07T12:00:00Z',status:'completed'};expect((await PATCH(req('PATCH',patch))).status).toBe(403);expect(m.update).not.toHaveBeenCalled();expect(m.audit).not.toHaveBeenCalled()})})
