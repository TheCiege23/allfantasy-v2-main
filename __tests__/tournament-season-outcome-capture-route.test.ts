import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocked = vi.hoisted(() => ({ session: vi.fn(), run: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocked.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/tournament/seasonOutcomeEvidenceWorker', () => ({ runSeasonOutcomeEvidenceJob: mocked.run }))
import { POST } from '@/app/api/tournament/season-outcome-capture/route'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'

const body = { tournamentId: 't1', freezeId: 'f1', leagueKey: 'pool', period: 1, sourceDate: '2026-10-11' }
const request = (value: unknown) => new NextRequest('https://test/api/tournament/season-outcome-capture',
  { method: 'POST', body: JSON.stringify(value) })
beforeEach(() => { vi.resetAllMocks(); mocked.session.mockResolvedValue({ user: { id: 'owner' } }) })

it('requires a signed-in owner and strict one-day input', async () => {
  mocked.session.mockResolvedValueOnce(null)
  expect((await POST(request(body))).status).toBe(401)
  expect((await POST(request({ ...body, userId: 'forged' }))).status).toBe(400)
  expect((await POST(request({ ...body, sourceDate: '2026-10-11/2026-10-12' }))).status).toBe(400)
  expect(mocked.run).not.toHaveBeenCalled()
})

it('returns only safe evidence counts and preserves worker refusals', async () => {
  mocked.run.mockResolvedValueOnce({ saved: 3, deferredByLimit: 7, scoringCertified: false, launchReady: false })
  const response = await POST(request(body))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({ saved: 3, scoringCertified: false })
  expect(mocked.run).toHaveBeenCalledWith('owner', 't1', 'f1', 'pool', 1, '2026-10-11')
  mocked.run.mockRejectedValueOnce(new BlueprintOperationError('Only the owner may capture evidence.', 403))
  expect((await POST(request(body))).status).toBe(403)
  mocked.run.mockRejectedValueOnce(new Error('secret provider token'))
  const failed = await POST(request(body))
  expect(failed.status).toBe(409)
  expect(JSON.stringify(await failed.json())).not.toContain('secret provider token')
})
