import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mock = vi.hoisted(() => ({ session: vi.fn(), review: vi.fn(), finalize: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mock.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/tournament/seasonScoreLedger', () => ({ reviewSeasonOpeningWeek: mock.review, finalizeSeasonOpeningWeek: mock.finalize }))
import { POST } from '@/app/api/tournament/season-scoring/route'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
const body = { action: 'review', tournamentId: 't1', freezeId: 'f1', key: 'pool', period: 1 }
const request = (data: unknown) => new NextRequest('https://test/api/tournament/season-scoring', { method: 'POST', body: JSON.stringify(data) })
beforeEach(() => { vi.resetAllMocks(); mock.session.mockResolvedValue({ user: { id: 'owner' } }) })
it('requires authentication before reading or writing', async () => {
 mock.session.mockResolvedValue(null); expect((await POST(request(body))).status).toBe(401); expect(mock.review).not.toHaveBeenCalled()
})
it('reviews one league/week using the session owner and private cache policy', async () => {
 mock.review.mockResolvedValue({ state: 'missing' }); const response = await POST(request(body))
 expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store')
 expect(mock.review).toHaveBeenCalledWith('owner','t1','f1','pool',1)
})
it('requires a reviewed revision and token for finalization', async () => {
 expect((await POST(request({ ...body, action: 'finalize' }))).status).toBe(400)
 mock.finalize.mockResolvedValue({ finalized: true })
 expect((await POST(request({ ...body, action: 'finalize', revision: 2, reviewToken: 'a'.repeat(64) }))).status).toBe(200)
 expect(mock.finalize).toHaveBeenCalledWith('owner','t1','f1','pool',1,2,'a'.repeat(64))
})
it.each([{ userId:'forged' },{ points:100 },{ period:0 },{ key:undefined },{ action:'ingest' }])('rejects forged/invalid command %j', async patch => {
 expect((await POST(request({ ...body, ...patch }))).status).toBe(400); expect(mock.review).not.toHaveBeenCalled(); expect(mock.finalize).not.toHaveBeenCalled()
})
it('preserves owner refusals and hides database/provider details', async () => {
 mock.review.mockRejectedValueOnce(new BlueprintOperationError('Owner only.',403))
 expect((await POST(request(body))).status).toBe(403)
 mock.review.mockRejectedValueOnce(new Error('secret provider connection'))
 const response = await POST(request(body)); expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain('secret')
 expect(response.headers.get('Cache-Control')).toBe('no-store')
})
