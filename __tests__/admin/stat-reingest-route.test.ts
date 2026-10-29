import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const gate = vi.fn()
const run = vi.fn()

vi.mock('@/lib/adminAuth', () => ({ requireAdminOrBearer: (req: Request) => gate(req) }))
vi.mock('@/lib/admin/statReingest', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/admin/statReingest')
  return { ...actual, runStatReingest: (...args: unknown[]) => run(...args) }
})
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { POST } from '@/app/api/admin/redraft/stat-reingest/route'

function post(body: unknown) {
  return new Request('http://localhost/api/admin/redraft/stat-reingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID = { sport: 'NHL', from: '2026-09-29', to: '2026-10-12' }

describe('POST /api/admin/redraft/stat-reingest', () => {
  beforeEach(() => {
    gate.mockReset()
    run.mockReset()
    run.mockResolvedValue({ ok: true })
  })

  it('401 when not signed in', async () => {
    gate.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    const res = await POST(post(VALID))
    expect(res.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('403 for a signed-in non-admin', async () => {
    gate.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    const res = await POST(post(VALID))
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('400 on an invalid body, without running anything', async () => {
    gate.mockResolvedValue({ ok: true, user: { id: 'u1', role: 'admin' } })
    const res = await POST(post({ ...VALID, to: '2026-12-31' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs as the admin with dryRun defaulting to true', async () => {
    gate.mockResolvedValue({ ok: true, user: { id: 'u1', role: 'admin' } })
    const res = await POST(post(VALID))
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toMatchObject({ sport: 'NHL', dryRun: true, confirm: null })
    expect(run.mock.calls[0][1]).toBe('admin:u1')
  })
})
