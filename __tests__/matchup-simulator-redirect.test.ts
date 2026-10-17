// @vitest-environment node
/**
 * Owner decision 2026-09-29: /matchup-simulator permanently redirects to /core Matchup.
 *
 * The old page asked an LLM (`/api/sim-matchup`) for a win percentage without the rosters. /core
 * Matchup is the one matchup surface. These pin: the redirect is PERMANENT (308, so search engines
 * and bookmarks move), it lands on /core/matchup, a `?leagueId=` deep link keeps its league as
 * /core's `?league=`, the LLM route is gone, and the registries that link the tool point at the
 * destination rather than at a hop.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The page this replaced read a session and the league table before rendering. Stubbed so that,
// run against the OLD page, this suite fails on its assertions rather than on a database.
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: vi.fn(async () => []) } } }))

import MatchupSimulatorPage from '@/app/matchup-simulator/page'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

/** Next implements redirect() as a thrown error whose digest is `NEXT_REDIRECT;<type>;<url>;<status>;`. */
async function redirectOf(searchParams: Record<string, string | string[] | undefined>) {
  try {
    await MatchupSimulatorPage({ searchParams: Promise.resolve(searchParams) })
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest ?? '')
    const [code, , url, status] = digest.split(';')
    if (code === 'NEXT_REDIRECT') return { url, status: Number(status) }
    throw error
  }
  return null
}

describe('/matchup-simulator → /core/matchup', () => {
  it('redirects permanently (308) to /core/matchup', async () => {
    expect(await redirectOf({})).toEqual({ url: '/core/matchup', status: 308 })
  })

  it('carries a ?leagueId= deep link across as /core ?league=', async () => {
    expect(await redirectOf({ leagueId: 'lg_123', sport: 'NBA' })).toEqual({
      url: '/core/matchup?league=lg_123',
      status: 308,
    })
  })

  it('encodes the league id and ignores an empty one', async () => {
    expect((await redirectOf({ leagueId: 'a b&c' }))?.url).toBe('/core/matchup?league=a%20b%26c')
    expect((await redirectOf({ leagueId: '  ' }))?.url).toBe('/core/matchup')
  })
})

describe('the LLM win-% path is gone', () => {
  it('/api/sim-matchup and its only callers are deleted', () => {
    for (const p of [
      'app/api/sim-matchup/route.ts',
      'components/sports/MatchupSimCard.tsx',
      'app/matchup-simulator/MatchupSimulatorClient.tsx',
    ]) {
      expect(`${p}: ${existsSync(resolve(process.cwd(), p))}`).toBe(`${p}: false`)
    }
  })
})

describe('links to the tool point at the destination, not at the hop', () => {
  it('the landing tool card links /core/matchup', () => {
    const src = read('components/landing/LandingFeatureCards.tsx')
    expect(src).not.toContain("href: '/matchup-simulator'")
    expect(src).toContain("href: '/core/matchup'")
  })

  it("the SEO tool config's open-tool link is /core/matchup", async () => {
    const { TOOL_CONFIG } = await import('@/lib/seo-landing/config')
    expect(TOOL_CONFIG['matchup-simulator'].openToolHref).toBe('/core/matchup')
  })
})
