/**
 * Yahoo is `coming_soon` in lib/league-import/provider-ui-config.ts, so nothing may START or SERVE a
 * Yahoo import: the three Yahoo entry points refuse before any login, cookie or Yahoo round trip,
 * with the same friendly sentence the rest of the product uses — never a 5xx, never an empty list.
 *
 * These run the real handlers against the real config (no availability mock), so if Yahoo is ever
 * flipped live without this file being updated, the first assertion says so in plain words.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'
import {
  getImportPlatforms,
  getImportPlatformStatus,
  importComingSoonMessage,
} from '@/lib/league-import/provider-ui-config'

const getServerSessionMock = vi.hoisted(() => vi.fn())
const requireVerifiedUserMock = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: requireVerifiedUserMock }))
vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage:
    () =>
    <T>(handler: T) =>
      handler,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

describe('the platform list is the single source of truth', () => {
  it('Yahoo is coming soon, and the live set is what the code actually imports', () => {
    expect(getImportPlatformStatus('yahoo')).toBe('coming_soon')
    const live = getImportPlatforms()
      .filter((p) => p.status === 'live')
      .map((p) => p.name)
    expect(live).toEqual(expect.arrayContaining(['Sleeper', 'ESPN', 'MFL', 'Fantrax']))
    expect(live).not.toContain('Yahoo')
  })

  it('the coming-soon sentence names the reason and the platforms that do work', () => {
    const msg = importComingSoonMessage('yahoo')
    expect(msg).toMatch(/^Yahoo import is coming soon/)
    expect(msg).toMatch(/approve our API access/)
    expect(msg).toMatch(/Sleeper/)
    expect(msg).not.toMatch(/You can import from[^.]*Yahoo/)
  })
})

describe('Yahoo entry points refuse while Yahoo is coming soon', () => {
  it('/api/yahoo/leagues GET answers 409 coming_soon before auth or any Yahoo call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('@/app/api/yahoo/leagues/route')
    const res = await GET(createMockNextRequest('http://localhost:3000/api/yahoo/leagues') as never)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'coming_soon', availability: 'coming_soon', connected: false })
    expect(body.error).toBe(importComingSoonMessage('yahoo'))
    expect(requireVerifiedUserMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('/api/yahoo/leagues POST refuses the same way', async () => {
    const { POST } = await import('@/app/api/yahoo/leagues/route')
    const res = await POST(
      createMockNextRequest('http://localhost:3000/api/yahoo/leagues', {
        method: 'POST',
        body: JSON.stringify({ leagueKey: '449.l.1' }),
      }) as never,
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('coming_soon')
  })

  it('/api/league/yahoo-auth sends the user back to where they started, not to Yahoo', async () => {
    const { GET } = await import('@/app/api/league/yahoo-auth/route')
    const res = await GET(
      createMockNextRequest('http://localhost:3000/api/league/yahoo-auth?returnTo=%2Fimport%3Fprovider%3Dyahoo') as never,
    )
    const location = res.headers.get('location') ?? ''
    expect(location).not.toMatch(/yahoo\.com/)
    expect(location).toContain('yahoo_error=coming_soon')
    expect(location).toMatch(/^\/import/)
    expect(getServerSessionMock).not.toHaveBeenCalled()
  })

  it('/api/auth/yahoo does the same, without asking anyone to sign in first', async () => {
    const { GET } = await import('@/app/api/auth/yahoo/route')
    const res = await GET(createMockNextRequest('http://localhost:3000/api/auth/yahoo?returnTo=%2Fimport') as never)
    const location = res.headers.get('location') ?? ''
    expect(location).not.toMatch(/login\.yahoo\.com|\/login\?/)
    expect(new URL(location).searchParams.get('yahoo_error')).toBe('coming_soon')
    expect(getServerSessionMock).not.toHaveBeenCalled()
  })
})
