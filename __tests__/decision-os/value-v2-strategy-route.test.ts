import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), role: vi.fn(), league: vi.fn(), read: vi.fn(), commit: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/decision-os/value-v2/strategyEvidence', () => ({ refreshStrategyFromEvidence: mocks.refresh }))
vi.mock('@/lib/decision-os/value-v2/strategyEvidencePrisma', () => ({ strategyEvidencePrismaPort: {} }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: mocks.role }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mocks.league } } }))
vi.mock('@/lib/decision-os/value-v2/strategyPrisma', () => ({ strategyPrismaPort: { read: mocks.read, commit: mocks.commit } }))
import { GET, POST } from '@/app/api/decision-os/strategy/route'

const url = 'https://allfantasy.ai/api/decision-os/strategy?leagueId=L'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.role.mockResolvedValue('member')
  mocks.league.mockResolvedValue({ season: 2026 })
  mocks.read.mockResolvedValue({ id: 'S', userId: 'owner', leagueId: 'L', season: 2026, active: 'balanced', revision: 3,
    lastObservedWeek: 3, pending: { strategy: 'rebuild', firstWeek: 1, lastWeek: 3, observations: 3, evidenceIds: ['a', 'b', 'c'] } })
  mocks.commit.mockResolvedValue(true)
  mocks.refresh.mockImplementation(async () => ({ state: await mocks.read(), completedWeek: 3, gaps: [], canConfirm: true }))
})
it('refreshes from server evidence only and omits evidence identifiers', async () => {
  expect((await post({ action: 'refresh', evidenceId: 'fake' })).status).toBe(400)
  const response = await post({ action: 'refresh' })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.evidence).toEqual({ available: true, completedWeek: 3, canConfirm: true })
  expect(JSON.stringify(body)).not.toContain('evidenceIds')
  expect(mocks.refresh.mock.calls[0][0]).toEqual({ userId: 'owner', leagueId: 'L', season: 2026 })
})
it('refuses confirmation when current results do not support the stored proposal', async () => {
  mocks.refresh.mockResolvedValueOnce({ state: await mocks.read(), completedWeek: null, gaps: ['stale'], canConfirm: false })
  expect((await post({ expectedRevision: 3, strategy: 'rebuild', confirmed: true })).status).toBe(409)
  expect(mocks.commit).not.toHaveBeenCalled()
})
const post = (body: unknown, origin = 'https://allfantasy.ai') => POST(new Request(url, {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))
it('requires a signed-in user and refuses nonmembers and viewers before reading strategy state', async () => {
  mocks.session.mockResolvedValueOnce(null)
  expect((await GET(new Request(url))).status).toBe(401)
  for (const role of [null, 'viewer']) {
    mocks.role.mockResolvedValueOnce(role)
    expect((await GET(new Request(url))).status).toBe(403)
  }
  expect(mocks.read).not.toHaveBeenCalled()
})
it('uses the session owner and recorded season regardless of query-supplied identity', async () => {
  const response = await GET(new Request(`${url}&userId=victim&season=2024`))
  expect(response.status).toBe(200)
  expect(mocks.read).toHaveBeenCalledWith({ userId: 'owner', leagueId: 'L', season: 2026 })
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).not.toHaveProperty('userId')
})
it('requires same-origin explicit confirmation and rejects injected observations or owner IDs', async () => {
  const valid = { expectedRevision: 3, strategy: 'rebuild', confirmed: true }
  expect((await post(valid, 'https://other.example')).status).toBe(403)
  for (const body of [{ ...valid, confirmed: false }, { ...valid, evidenceId: 'fake' }, { ...valid, userId: 'victim' }]) {
    expect((await post(body)).status).toBe(400)
  }
  expect(mocks.commit).not.toHaveBeenCalled()
})
it('confirms only the owners current revision and reports concurrent changes', async () => {
  expect((await post({ expectedRevision: 2, strategy: 'rebuild', confirmed: true })).status).toBe(409)
  const response = await post({ expectedRevision: 3, strategy: 'rebuild', confirmed: true })
  expect(response.status).toBe(200)
  expect((await response.json()).active).toBe('rebuild')
  expect(mocks.commit.mock.calls[0][0].scope.userId).toBe('owner')
  mocks.commit.mockResolvedValueOnce(false)
  expect((await post({ expectedRevision: 3, strategy: 'rebuild', confirmed: true })).status).toBe(409)
})
