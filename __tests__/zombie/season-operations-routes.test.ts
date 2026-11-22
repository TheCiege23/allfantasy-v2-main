// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), preview: vi.fn(), approve: vi.fn(), read: vi.fn(), govern: vi.fn(), owner: vi.fn(), evidence: vi.fn(), sports: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/zombie/seasonOperations', () => ({ previewSeasonAccounting: m.preview, approveSeasonAccounting: m.approve, readSeasonOperations: m.read, governanceAction: m.govern, ownerRecoveryAction: m.owner, ZombieOperationsError: class extends Error {} }))
vi.mock('@/lib/zombie/acceptanceEvidence', () => ({ saveAcceptanceEvidence: m.evidence, sportAcceptanceEvidence: m.sports }))
import { GET, POST } from '@/app/api/zombie/season-operations/route'
const req = (body: unknown) => new Request('http://localhost/api/zombie/season-operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue({ user: { id: 'session-owner' } }); m.read.mockResolvedValue({ records: [] }) })
describe('season operations API boundaries', () => {
  it('rejects signed-out access before any operations read', async () => {
    m.session.mockResolvedValue(null); expect((await GET(new Request('http://localhost/api/zombie/season-operations?leagueId=l'))).status).toBe(401); expect(m.read).not.toHaveBeenCalled()
  })
  it('takes the actor from the session and never accepts a forged actor', async () => {
    expect((await POST(req({ leagueId: 'l', action: 'preview', userId: 'forged' }))).status).toBe(400); expect(m.preview).not.toHaveBeenCalled()
  })
  it('redacts saved source evidence from the preview response', async () => {
    m.preview.mockResolvedValue({ id: 'r', payload: { hash: 'h', plan: { blockers: [] }, source: { private: 'never return' } } })
    const result = await POST(req({ leagueId: 'l', action: 'preview', funding: { ultimateOpeningCents: 0 } }))
    expect(await result.json()).toEqual({ review: { id: 'r', hash: 'h', plan: { blockers: [] } } }); expect(m.preview).toHaveBeenCalledWith('l', 'session-owner', { ultimateOpeningCents: 0 })
  })
  it('does not accept fractional or negative opening money', async () => {
    for (const n of [-1, 1.5]) expect((await POST(req({ leagueId: 'l', action: 'preview', funding: { ultimateOpeningCents: n } }))).status).toBe(400)
    expect(m.preview).not.toHaveBeenCalled()
  })
  it('returns a failure if approval does not commit', async () => {
    m.approve.mockRejectedValue(new Error('database fail'))
    expect((await POST(req({ leagueId: 'l', action: 'approve', reviewId: 'r', hash: 'a'.repeat(64), reason: 'Reviewed exact allocation' }))).status).toBe(409)
  })
})
