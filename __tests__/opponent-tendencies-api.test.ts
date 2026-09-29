import { expect, it } from 'vitest'
import { NextRequest } from 'next/server'
// The /api/ai/opponent-tendencies alias is deleted; /api/legacy/opponent-tendencies still serves this handler.
import { GET, POST } from '@/server/api-route-modules/legacy/opponent-tendencies/route'
it.each([GET, POST])('keeps the legacy route closed even when callers supply an origin and roster identity', async handler => {
  const response = await handler(new NextRequest('https://allfantasy.ai/api/legacy/opponent-tendencies?leagueId=L&rosterId=1'))
  expect(response.status).toBe(410)
  expect(await response.json()).toHaveProperty('code', 'PROFILE_SURFACE_RETIRED')
})
