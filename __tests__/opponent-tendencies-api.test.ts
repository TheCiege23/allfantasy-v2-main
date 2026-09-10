import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
import { GET, POST } from '@/app/api/ai/opponent-tendencies/route'
it.each([GET, POST])('keeps the canonical alias closed even when callers supply an origin and roster identity', async handler => {
  const response = await handler(new NextRequest('https://allfantasy.ai/api/ai/opponent-tendencies?leagueId=L&rosterId=1'), {})
  expect(response.status).toBe(410)
  expect(await response.json()).toHaveProperty('code', 'PROFILE_SURFACE_RETIRED')
})
