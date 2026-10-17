vi.mock('@/lib/tournament/seasonRosterPreparation', () => ({ prepareSeasonOpeningRosters: mock.prepare }))
vi.mock('@/lib/tournament/seasonOpeningReadiness', () => ({ reviewSeasonOpeningDraft: mock.review }))
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mock = vi.hoisted(() => ({ session: vi.fn(), setup: vi.fn(), load: vi.fn(), check: vi.fn(), review: vi.fn(), prepare: vi.fn(), period: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mock.session }))
vi.mock('@/lib/tournament/seasonDraftReadiness', () => ({ checkSeasonDraftReadiness: mock.check }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/tournament/seasonNativeProvisioning', () => ({ provisionNextSeasonLeague: mock.setup, loadSeasonNativeSetup: mock.load }))
vi.mock('@/lib/tournament/seasonPeriodLiveReview', () => ({ reviewSeasonPeriodLiveFeed: mock.period }))
import { POST, GET } from '@/app/api/tournament/season-setup/route'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
const request = (body: unknown) => new NextRequest('https://test/api/tournament/season-setup', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => { vi.resetAllMocks(); mock.session.mockResolvedValue({ user: { id: 'owner' } }) })
it('authenticates before setup or reading progress', async () => {
  mock.session.mockResolvedValue(null)
  expect((await POST(request({}))).status).toBe(401)
  expect((await GET(new NextRequest('https://test/api/tournament/season-setup?tournamentId=t1'))).status).toBe(401)
  expect(mock.setup).not.toHaveBeenCalled()
})
it('uses the session actor and ignores forged tenant identity', async () => {
  mock.setup.mockResolvedValue({ complete: false })
  const response = await POST(request({ tournamentId: 't1', freezeId: 'f1', key: 'stage-1-league-1', userId: 'forged', tenantId: 'other' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(mock.setup).toHaveBeenCalledWith('owner', 't1', 'f1', 'stage-1-league-1')
})
it('validates inputs and preserves safe owner refusals', async () => {
  expect((await POST(request({ tournamentId: 't1' }))).status).toBe(400)
  mock.setup.mockRejectedValue(new BlueprintOperationError('Owner only.', 403))
  expect((await POST(request({ tournamentId: 't1', freezeId: 'f1' }))).status).toBe(403)
})
it('hides database error details and returns private progress', async () => {
  mock.setup.mockRejectedValue(new Error('secret connection string'))
  const response = await POST(request({ tournamentId: 't1', freezeId: 'f1' }))
  expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('secret')
  mock.load.mockResolvedValue({ freezeId: 'f1' })
  expect((await GET(new NextRequest('https://test/api/tournament/season-setup?tournamentId=t1'))).headers.get('Cache-Control')).toBe('no-store')
})

it('checks draft pools using the authenticated owner without provisioning', async () => {
  mock.check.mockResolvedValue({ launchReady: false, reports: [] })
  expect((await POST(request({ action: 'check_draft', tournamentId: 't1', freezeId: 'f1' }))).status).toBe(200)
  expect(mock.check).toHaveBeenCalledWith('owner', 't1', 'f1')
  expect(mock.setup).not.toHaveBeenCalled()
})


it('supports a bounded single-league recovery command', async () => {
  mock.check.mockResolvedValue({ launchReady: false, reports: [] })
  expect((await POST(request({ action: 'check_draft', tournamentId: 't1', freezeId: 'f1', key: 'pool-1' }))).status).toBe(200)
  expect(mock.check).toHaveBeenCalledWith('owner', 't1', 'f1', 'pool-1')
})

it('reviews only the requested league with authenticated ownership and private caching', async () => {
  mock.review.mockResolvedValue({ state: 'completed', launchReady: false })
  const response = await POST(request({ action: 'review_draft', tournamentId: 't1', freezeId: 'f1', key: 'pool-1', userId: 'outsider' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(mock.review).toHaveBeenCalledWith('owner', 't1', 'f1', 'pool-1')
  expect(mock.check).not.toHaveBeenCalled(); expect(mock.setup).not.toHaveBeenCalled()
})
it('requires an explicit league for draft review and rejects launch commands', async () => {
  expect((await POST(request({ action: 'review_draft', tournamentId: 't1', freezeId: 'f1' }))).status).toBe(400)
  expect((await POST(request({ action: 'launch', tournamentId: 't1', freezeId: 'f1', key: 'pool-1' }))).status).toBe(400)
  expect(mock.review).not.toHaveBeenCalled()
})
it('reviews only an explicit published period as the authenticated owner', async () => {
  expect((await POST(request({ action: 'refresh_period', tournamentId: 't1', freezeId: 'f1' }))).status).toBe(400)
  mock.period.mockResolvedValue({ period: 1, scoringCertified: false, launchReady: false })
  const response = await POST(request({ action: 'refresh_period', tournamentId: 't1', freezeId: 'f1', period: 1, userId: 'forged' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(mock.period).toHaveBeenCalledWith('owner', 't1', 'f1', 1, undefined)
  await POST(request({ action: 'refresh_period', tournamentId: 't1', freezeId: 'f1', period: 1, key: 'pool-1' }))
  expect(mock.period).toHaveBeenLastCalledWith('owner', 't1', 'f1', 1, 'pool-1')
})

it('prepares only the selected league using the authenticated owner', async () => {
 mock.prepare.mockResolvedValue({ prepared: true, launchReady: false })
 expect((await POST(request({ action: 'prepare_rosters', tournamentId: 't1', freezeId: 'f1', key: 'pool-1' }))).status).toBe(200)
 expect(mock.prepare).toHaveBeenCalledWith('owner', 't1', 'f1', 'pool-1')
 expect((await POST(request({ action: 'prepare_rosters', tournamentId: 't1', freezeId: 'f1' }))).status).toBe(400)
})
