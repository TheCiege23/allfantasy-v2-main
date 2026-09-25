import { beforeEach, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
const mocks = vi.hoisted(() => ({ gate: vi.fn(), read: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/api/require-league-access', () => ({ requireLeagueApiAccess: mocks.gate }))
vi.mock('@/lib/relationship-insights', () => ({ getUnifiedRelationshipInsights: mocks.read, runRelationshipInsightOrchestrator: mocks.run }))
import { GET, POST } from '@/app/api/leagues/[leagueId]/relationship-insights/handler'
const context = { params: Promise.resolve({ leagueId: 'L' }) }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.gate.mockResolvedValue({ ok: true })
  mocks.run.mockResolvedValue({ season: 2026 })
  mocks.read.mockResolvedValue({ leagueId: 'L', sport: 'NFL', season: 2026, relationshipProfile: {}, rivalries: [], drama: [], storylines: [],
    profiles: [{ profileLabels: ['chaos agent'], aggressionScore: 91 }],
    behaviorDramaContext: [{ profile: { profileLabels: ['chaos agent'] }, behaviorHeat: 88 }] })
})
it.each([GET, POST])('projects the actual relationship response without raw profiles', async handler => {
  const request = new Request('https://allfantasy.ai/api/leagues/L/relationship-insights', { method: 'POST', body: '{}' })
  const response = await handler(request, context)
  expect(response.status).toBe(200)
  const output = JSON.stringify(await response.json())
  expect(output).not.toMatch(/chaos agent|aggressionScore|behaviorHeat/)
  expect(mocks.read).toHaveBeenCalledTimes(1)
})
it.each([GET, POST])('checks membership before computing relationship facts', async handler => {
  mocks.gate.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) })
  expect((await handler(new Request('https://allfantasy.ai/api/leagues/L/relationship-insights'), context)).status).toBe(403)
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.run).not.toHaveBeenCalled()
})
