// @vitest-environment node
/**
 * Owner decision 2026-10-20: the `matchup-simulator` tool card is renamed Simulation Lab
 * (`simulation-lab`). Its public SEO page moves to /tools/simulation-lab. /tools/matchup-simulator
 * stays a PERMANENT (308) redirect so search rankings and existing links carry over. The sitemap,
 * static params, canonical URL and EN/ES hub strings follow the new slug.
 *
 * (The separate /matchup-simulator → /core/matchup redirect is pinned in
 * matchup-simulator-redirect.test.ts and is unchanged.)
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The sitemap reads blog and player rows; an empty DB keeps it to the static and slug-derived URLs.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    blogArticle: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
  },
}))

/** Next implements redirect() as a thrown error whose digest is `NEXT_REDIRECT;<type>;<url>;<status>;`. */
async function redirectOf(searchParams: Record<string, string | string[] | undefined>) {
  const page = 'app/tools/matchup-simulator/page.tsx'
  expect(`${page}: ${existsSync(resolve(process.cwd(), page))}`).toBe(`${page}: true`)
  const { default: Page } = await import('@/app/tools/matchup-simulator/page')
  try {
    await Page({ searchParams: Promise.resolve(searchParams) })
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest ?? '')
    const [code, , url, status] = digest.split(';')
    if (code === 'NEXT_REDIRECT') return { url, status: Number(status) }
    throw error
  }
  return null
}

describe('/tools/matchup-simulator → /tools/simulation-lab', () => {
  it('redirects permanently (308)', async () => {
    expect(await redirectOf({})).toEqual({ url: '/tools/simulation-lab', status: 308 })
  })

  it('carries the query string across (UTM tags, shared links)', async () => {
    expect(await redirectOf({ utm_source: 'news letter', ref: ['a', 'b'] })).toEqual({
      url: '/tools/simulation-lab?utm_source=news+letter&ref=a&ref=b',
      status: 308,
    })
  })
})

describe('the SEO surface follows the new slug', () => {
  it('the [tool] page statically renders simulation-lab and not the old slug', async () => {
    const { generateStaticParams } = await import('@/app/tools/[tool]/page')
    const tools = (await generateStaticParams()).map((p) => p.tool)
    expect(tools).toContain('simulation-lab')
    expect(tools).not.toContain('matchup-simulator')
  })

  it('canonical metadata for /tools/simulation-lab points at itself, titled Simulation Lab', async () => {
    const { generateMetadata } = await import('@/app/tools/[tool]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ tool: 'simulation-lab' }) })
    expect(meta.alternates?.canonical).toBe('https://allfantasy.ai/tools/simulation-lab')
    expect(String(meta.title)).toMatch(/^Simulation Lab/)
  })

  it('the sitemap lists /tools/simulation-lab and not /tools/matchup-simulator', async () => {
    const { GET } = await import('@/app/sitemap.xml/route')
    const xml = await (await GET()).text()
    expect(xml).toMatch(/<loc>[^<]*\/tools\/simulation-lab<\/loc>/)
    expect(xml).not.toContain('/tools/matchup-simulator')
  })

  it('EN and ES hub strings exist under the new key and not the old one', async () => {
    const { translations } = await import('@/lib/i18n/translations')
    for (const lang of ['en', 'es'] as const) {
      expect(translations[lang]['toolsHub.tool.simulation-lab.headline']).toBeTruthy()
      expect(translations[lang]['toolsHub.tool.simulation-lab.description']).toBeTruthy()
      expect(translations[lang]['toolsHub.tool.matchup-simulator.headline']).toBeUndefined()
    }
    expect(translations.en['toolsHub.tool.simulation-lab.headline']).toBe('Simulation Lab')
  })
})
