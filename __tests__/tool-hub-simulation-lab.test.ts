// @vitest-environment node
/**
 * Owner decision 2026-10-20: the tool hub opens the Simulation Lab (/app/simulation-lab).
 *
 * From 2026-09-29 (5acd6ddad) the matchup-simulator card opened /core/matchup and the hub's sport
 * filter aliased /app/simulation-lab to /core/matchup. That happened when the old /matchup-simulator
 * page became a 308 to /core Matchup. These tests pin the new destination at each place the hub reads,
 * and the card's 2026-10-20 rename from `matchup-simulator` to `simulation-lab`.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// One sport whose hub shortlist names only the Simulation Lab, so the sport filter's alias is what
// decides whether the simulation-lab card survives (no fallback to "all tools").
vi.mock('@/lib/seo-landing/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo-landing/config')>()
  const [first] = actual.SPORT_SLUGS
  return {
    ...actual,
    SPORT_CONFIG: {
      ...actual.SPORT_CONFIG,
      [first]: {
        ...actual.SPORT_CONFIG[first],
        toolHrefs: [{ label: 'Simulation Lab', href: '/app/simulation-lab' }],
      },
    },
  }
})

import { SPORT_SLUGS, TOOL_CONFIG, TOOL_SLUGS, getToolCanonical } from '@/lib/seo-landing/config'
import { getAllTools, getToolsForSport, getToolsInCategory } from '@/lib/tool-hub/ToolHubService'

describe('tool hub → Simulation Lab', () => {
  it('the Simulation Lab page exists', () => {
    expect(existsSync(resolve(process.cwd(), 'app/app/simulation-lab/page.tsx'))).toBe(true)
  })

  it('the simulation-lab card in the hub is titled Simulation Lab and opens /app/simulation-lab', () => {
    const card = getAllTools().find((t) => t.slug === 'simulation-lab')
    expect(card?.headline).toBe('Simulation Lab')
    expect(card?.openToolHref).toBe('/app/simulation-lab')
    expect(TOOL_CONFIG['simulation-lab'].openToolHref).toBe('/app/simulation-lab')
  })

  it('the old matchup-simulator slug is gone from the tool registry', () => {
    expect(TOOL_SLUGS).toContain('simulation-lab')
    expect(TOOL_SLUGS as string[]).not.toContain('matchup-simulator')
    expect(Object.keys(TOOL_CONFIG)).not.toContain('matchup-simulator')
    for (const slug of TOOL_SLUGS) {
      expect(TOOL_CONFIG[slug].relatedToolSlugs as string[]).not.toContain('matchup-simulator')
    }
  })

  it('canonical URL is /tools/simulation-lab', () => {
    expect(getToolCanonical('simulation-lab')).toBe('https://allfantasy.ai/tools/simulation-lab')
  })

  // landing_tool_visit reports /tools/simulation-lab: see tool-landing-analytics-path.test.tsx.

  it('no hub card opens /core/matchup through the simulator tool', () => {
    const hrefs = getAllTools().map((t) => `${t.slug} -> ${t.openToolHref}`)
    expect(hrefs).not.toContain('simulation-lab -> /core/matchup')
  })

  it("the 'simulate' category lists the simulator card with the same destination", () => {
    const card = getToolsInCategory('simulate').find((t) => t.slug === 'simulation-lab')
    expect(card?.openToolHref).toBe('/app/simulation-lab')
  })

  it("a sport that lists /app/simulation-lab gets exactly the simulator card, opening the lab", () => {
    const tools = getToolsForSport(SPORT_SLUGS[0])
    expect(tools.map((t) => `${t.slug} -> ${t.openToolHref}`)).toEqual([
      'simulation-lab -> /app/simulation-lab',
    ])
  })
})
