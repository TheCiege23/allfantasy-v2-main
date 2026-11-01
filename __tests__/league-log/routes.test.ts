import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  patch: vi.fn(),
  read: vi.fn(),
  role: vi.fn(),
  audit: vi.fn(),
  undo: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: m.patch }))
vi.mock('@/lib/league-log/leagueLogService', () => ({ readLeagueLog: m.read }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: m.role }))
vi.mock('@/server/services/auditService', () => ({ getAuditLogs: m.audit }))
vi.mock('@/lib/commissioner-undo/commissionerUndoService', () => ({ undoCommissionerAction: m.undo }))

import { GET, POST, PUT } from '@/app/api/leagues/[leagueId]/league-log/handler'
import { GET as RAW_GET } from '@/app/api/leagues/[leagueId]/audit-logs/handler'

const ctx = { params: { leagueId: 'L' } }
const url = 'http://x/api/leagues/L/league-log'

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u1' } })
  m.patch.mockResolvedValue(new Response('{}', { status: 200 }))
  m.read.mockResolvedValue({ ok: true, canManage: false, visibility: 'league', hidden: false, entries: [], nextCursor: null })
  m.audit.mockResolvedValue({ items: [{ id: 'raw' }], nextCursor: null })
})

describe('GET /api/leagues/:id/league-log', () => {
  it('needs a session', async () => {
    m.session.mockResolvedValue(null)
    expect((await GET(new NextRequest(url), ctx)).status).toBe(401)
  })

  it('passes language, paging and a known category through, and drops an unknown category', async () => {
    await GET(new NextRequest(`${url}?lang=es&limit=10&cursor=c1&category=scoring`), ctx)
    expect(m.read).toHaveBeenCalledWith('L', 'u1', { lang: 'es', limit: 10, cursor: 'c1', category: 'scoring' })
    await GET(new NextRequest(`${url}?category=secrets`), ctx)
    expect(m.read.mock.calls[1][2].category).toBeNull()
  })

  it('returns the service status when the viewer is not in the league', async () => {
    m.read.mockResolvedValue({ ok: false, status: 403 })
    expect((await GET(new NextRequest(url), ctx)).status).toBe(403)
  })
})

describe('PUT /api/leagues/:id/league-log', () => {
  it('saves the visibility through the settings patch, so its role and lock checks apply', async () => {
    const res = await PUT(new NextRequest(url, { method: 'PUT', body: JSON.stringify({ visibility: 'commish_only' }) }), ctx)
    expect(res.status).toBe(200)
    expect(m.patch).toHaveBeenCalledWith('u1', { leagueId: 'L', settingsMerge: { league_log_visibility: 'commish_only' } }, { section: 'commissioner' })
  })

  it('refuses an unknown value without saving', async () => {
    const res = await PUT(new NextRequest(url, { method: 'PUT', body: JSON.stringify({ visibility: 'public' }) }), ctx)
    expect(res.status).toBe(400)
    expect(m.patch).not.toHaveBeenCalled()
  })
})

describe('POST /api/leagues/:id/league-log (undo)', () => {
  const post = (body: unknown) => POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }), ctx)

  it('needs a session and passes the signed-in user and the row id to the undo', async () => {
    m.session.mockResolvedValueOnce(null)
    expect((await post({ auditId: 'a1' })).status).toBe(401)
    expect(m.undo).not.toHaveBeenCalled()
    m.undo.mockResolvedValueOnce({ ok: true, actionType: 'commissioner_edit_faab' })
    const res = await post({ auditId: 'a1' })
    expect(res.status).toBe(200)
    expect(m.undo).toHaveBeenCalledWith('L', 'u1', 'a1')
  })

  it('answers a refusal with its status and a plain reason', async () => {
    m.undo.mockResolvedValueOnce({ ok: false, error: 'waiver_run_since', status: 409 })
    const refused = await post({ auditId: 'a1' })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'Waivers have run since, and they used this value.', code: 'waiver_run_since' })
    m.undo.mockResolvedValueOnce({ ok: false, error: 'forbidden', status: 403 })
    expect((await post({ auditId: 'a1' })).status).toBe(403)
  })
})

describe('GET /api/leagues/:id/audit-logs (the raw rows)', () => {
  const raw = 'http://x/api/leagues/L/audit-logs'
  it('is refused to a member, who reads the worded league log instead', async () => {
    m.role.mockResolvedValue('member')
    const res = await RAW_GET(new NextRequest(raw), ctx)
    expect(res.status).toBe(403)
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('still serves commissioners and co-commissioners', async () => {
    for (const role of ['commissioner', 'co_commissioner']) {
      m.role.mockResolvedValue(role)
      const res = await RAW_GET(new NextRequest(raw), ctx)
      expect(res.status).toBe(200)
    }
  })
})
