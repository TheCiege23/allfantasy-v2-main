// @vitest-environment node
/**
 * Owner decision 2026-10-20: the tool hub opens the Simulation Lab (/app/simulation-lab).
 *
 * From 2026-09-29 (5acd6ddad) the matchup-simulator card opened /core/matchup and the hub's sport
 * filter aliased /app/simulation-lab to /core/matchup. That happened when the old /matchup-simulator
 * page became a 308 to /core Matchup. These tests pin the new destination at each place the hub reads.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// One sport whose hub shortlist names only the Simulation Lab, so the sport filter's alias is what
// decides whether the matchup-simulator card survives (no fallback to "all tools").
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

import { SPORT_SLUGS, TOOL_CONFIG } from '@/lib/seo-landing/config'
import { getAllTools, getToolsForSport, getToolsInCategory } from '@/lib/tool-hub/ToolHubService'

describe('tool hub → Simulation Lab', () => {
  it('the Simulation Lab page exists', () => {
    expect(existsSync(resolve(process.cwd(), 'app/app/simulation-lab/page.tsx'))).toBe(true)
  })

  it('the matchup-simulator card in the hub opens /app/simulation-lab', () => {
    const card = getAllTools().find((t) => t.slug === 'matchup-simulator')
    expect(card?.openToolHref).toBe('/app/simulation-lab')
    expect(TOOL_CONFIG['matchup-simulator'].openToolHref).toBe('/app/simulation-lab')
  })

  it('no hub card opens /core/matchup through the simulator tool', () => {
    const hrefs = getAllTools().map((t) => `${t.slug} -> ${t.openToolHref}`)
    expect(hrefs).not.toContain('matchup-simulator -> /core/matchup')
  })

  it("the 'simulate' category lists the simulator card with the same destination", () => {
    const card = getToolsInCategory('simulate').find((t) => t.slug === 'matchup-simulator')
    expect(card?.openToolHref).toBe('/app/simulation-lab')
  })

  it("a sport that lists /app/simulation-lab gets exactly the simulator card, opening the lab", () => {
    const tools = getToolsForSport(SPORT_SLUGS[0])
    expect(tools.map((t) => `${t.slug} -> ${t.openToolHref}`)).toEqual([
      'matchup-simulator -> /app/simulation-lab',
    ])
  })
})
