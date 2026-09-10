import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { GET as legacyGet, POST as legacyPost } from '@/server/api-route-modules/legacy/manager-dna/route'
import { GET as aiGet, POST as aiPost } from '@/app/api/ai/manager-dna/route'
import { POST as draftPost } from '@/app/api/mock-draft/manager-dna/route'
import { GET as directoryGet } from '@/app/api/v1/intelligence/league/manager-dna/route'
import { GET as managerGet } from '@/app/api/v1/intelligence/manager/route'
import { GET as managersGet } from '@/app/api/v1/intelligence/league/managers/route'
import { GET as tradeProfileGet } from '@/app/api/user/trade-profile/route'
import { formatDNAForPrompt, type ManagerDNAProfile } from '@/lib/manager-dna'
import { formatOpponentForPrompt, type OpponentProfile } from '@/lib/opponent-tendencies'
const routes = [
  ['legacy DNA GET', legacyGet], ['legacy DNA POST', legacyPost],
  ['canonical DNA GET', aiGet], ['canonical DNA POST', aiPost],
  ['draft DNA POST', draftPost], ['DNA directory GET', directoryGet],
  ['v1 manager GET', managerGet], ['v1 managers GET', managersGet], ['inferred trade profile GET', tradeProfileGet],
] as const
it.each(routes)('%s cannot return profiles even with owner, premium, rollup or presentation parameters', async (_name, handler) => {
  const response = await handler(new NextRequest('https://allfantasy.ai/api/test?username=owner&premium=true&view=presentation&rollup=true', { method: 'POST', body: '{invalid' }), {})
  expect(response.status).toBe(410)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ error: 'Use Competitive Edge within a league decision.', code: 'PROFILE_SURFACE_RETIRED' })
})
it('whole-profile prompt formatters withhold even complete cached profiles', () => {
  expect(formatDNAForPrompt({ archetype: 'The Gambler', confidence: 1, metrics: { riskTolerance: 1 }, blindSpots: ['private'] } as unknown as ManagerDNAProfile)).toBe('')
  expect(formatOpponentForPrompt({ confidence: 1, tendencies: { rookieBias: 1 }, pitchAngles: [{ description: 'private' }] } as unknown as OpponentProfile)).toBe('')
})
