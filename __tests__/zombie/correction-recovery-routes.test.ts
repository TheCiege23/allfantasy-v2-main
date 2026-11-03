// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ session: vi.fn(), league: vi.fn(), list: vi.fn(), one: vi.fn(), weeks: vi.fn(), teams: vi.fn(), prepare: vi.fn(), apply: vi.fn(), external: vi.fn(), effects: vi.fn(), permission: vi.fn(), approveReport: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { zombieLeague: { findUnique: h.league }, zombieCorrectionReview: { findMany: h.list, findUnique: h.one }, zombieWeeklyResolution: { findMany: h.weeks }, zombieLeagueTeam: { findMany: h.teams } } }))
vi.mock('@/lib/zombie/beta2025CorrectionService', () => ({ ZombieRecoveryError: class extends Error {}, prepareZombieCorrection: h.prepare, applyZombieCorrection: h.apply, acknowledgeExternalCorrection: h.external }))
vi.mock('@/lib/zombie/correctionFollowup', () => ({ finishZombieCorrectionEffects: h.effects }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: h.permission }))
vi.mock('@/lib/zombie/weeklyReportApproval', () => ({ approveZombieWeeklyReport: h.approveReport }))
vi.mock('@/lib/zombie/weeklyUpdateEngine', () => ({ buildWeeklyUpdate: vi.fn() }))
import * as route from '@/app/api/zombie/corrections/route'
import { POST as approveReport } from '@/app/api/zombie/weekly-update/route'
const req = (body: object) => new Request('http://localhost/api/zombie/corrections', { method: 'POST', body: JSON.stringify(body) })
const get = () => new Request('http://localhost/api/zombie/corrections?leagueId=L')
const review = { id: 'R', fromWeek: 1, sourceHash: 'hash', status: 'ready', effectsPending: false, appliedAt: null, source: { secret: 'private-snapshot' },
  plan: { blockers: [], summary: [], weeks: [], original: [], externalReviews: [], secretCandidateOrder: 'hidden-order' } }
beforeEach(() => {
  vi.resetAllMocks(); h.session.mockResolvedValue({ user: { id: 'owner' } }); h.league.mockResolvedValue({ id: 'Z', correctionHoldFromWeek: 1, league: { userId: 'owner' } })
  h.list.mockResolvedValue([review]); h.one.mockResolvedValue({ zombieLeagueId: 'Z' }); h.weeks.mockResolvedValue([]); h.teams.mockResolvedValue([])
  h.prepare.mockResolvedValue(review); h.apply.mockResolvedValue({ reviewId: 'R', repeated: false, effectsPending: true }); h.effects.mockResolvedValue({ pending: false }); h.approveReport.mockResolvedValue({ ok: true })
})
describe('owner-only correction and report recovery routes', () => {
  it('requires authentication before any private lookup', async () => {
    h.session.mockResolvedValue(null)
    expect((await route.GET(get())).status).toBe(401)
    expect((await route.POST(req({ leagueId: 'L', action: 'preview', week: 1 }))).status).toBe(401)
    expect(h.league).not.toHaveBeenCalled(); expect(h.list).not.toHaveBeenCalled()
  })
  it('denies a member or co-commissioner before querying correction snapshots', async () => {
    h.session.mockResolvedValue({ user: { id: 'member' } })
    expect((await route.GET(get())).status).toBe(403)
    expect((await route.POST(req({ leagueId: 'L', action: 'preview', week: 1 }))).status).toBe(403)
    expect(h.list).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled()
  })
  it('returns review consequences without exposing saved private snapshots or candidate order', async () => {
    const response = await route.GET(get()), text = await response.text()
    expect(response.status).toBe(200); expect(text).not.toContain('private-snapshot'); expect(text).not.toContain('hidden-order'); expect(text).not.toContain('source"')
    expect(JSON.parse(text).reviews[0]).toMatchObject({ id: 'R', sourceHash: 'hash', blockers: [] })
  })
  it('prepares only an integer week and uses the session actor', async () => {
    expect((await route.POST(req({ leagueId: 'L', action: 'preview', week: 1.2 }))).status).toBe(400)
    expect((await route.POST(req({ leagueId: 'L', action: 'preview', week: 1, actorId: 'other' }))).status).toBe(200)
    expect(h.prepare).toHaveBeenCalledWith('L', 1, 'owner')
  })
  it.each(['approve', 'retry_effects', 'external_review'])('rejects a cross-league %s request before executing it', async action => {
    h.one.mockResolvedValue({ zombieLeagueId: 'OTHER' })
    expect((await route.POST(req({ leagueId: 'L', action, reviewId: 'foreign', sourceHash: 'hash', reason: 'A full review reason' }))).status).toBe(404)
    expect(h.apply).not.toHaveBeenCalled(); expect(h.effects).not.toHaveBeenCalled(); expect(h.external).not.toHaveBeenCalled()
  })
  it('reports durable follow-up pending when standings or report delivery fails after game-state commit', async () => {
    h.effects.mockRejectedValue(new Error('Unavailable'))
    const response = await route.POST(req({ leagueId: 'L', action: 'approve', reviewId: 'R', sourceHash: 'hash', reason: 'Reviewed all affected weeks' }))
    expect(await response.json()).toMatchObject({ reviewId: 'R', effectsPending: true })
    expect(h.apply).toHaveBeenCalledWith('L', 'R', 'hash', 'owner', 'Reviewed all affected weeks')
  })
  it('returns a conflict without claiming a failed transaction committed', async () => {
    h.apply.mockRejectedValue(new Error('DB failure'))
    const response = await route.POST(req({ leagueId: 'L', action: 'approve', reviewId: 'R', sourceHash: 'hash', reason: 'Reviewed all affected weeks' }))
    expect(response.status).toBe(409); expect(h.effects).not.toHaveBeenCalled()
  })
  it('returns the report permission denial before posting', async () => {
    h.permission.mockRejectedValue(new Response('Forbidden', { status: 403 }))
    expect((await approveReport(req({ leagueId: 'L', week: 1 }))).status).toBe(403)
    expect(h.approveReport).not.toHaveBeenCalled()
  })
})
