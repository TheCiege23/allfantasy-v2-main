import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The Defense Hub entry in the /core rail.
 *
 * 🛑 THE BUG THIS CLOSES. `/core` is the canonical home, and it is a DIFFERENT shell from
 * `/league/[leagueId]` — which is where the Defense Hub tab lived. So a manager in KBFL (an IDP
 * league that starts DL DL LB LB DB DB IDP_FLEX IDP_FLEX) opened /core and had no way to reach
 * the Defense Hub at all. It existed, and was unreachable from the surface people actually use.
 *
 * ⚠ THE ENTRY IS CONDITIONAL, AND THAT IS THE HALF THAT ROTS QUIETLY. Only ~10 of 115 leagues
 * score IDP. An unconditional entry sends the other ~105 to a screen that says "this league
 * doesn't roster individual defenders" — the "not built yet" panel problem the rail's own
 * comments record having already made once.
 *
 * These are source assertions rather than a render, for the same reason `devy-wiring.test.ts`
 * is: the failure mode is a screen that exists and is not reachable, which no unit test of the
 * screen itself can see.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const SHELL = read('components/core-app/AfCoreShell.tsx')
const PAGE = read('app/core/[[...screen]]/page.tsx')

describe('/core Defense Hub rail entry', () => {
  it('declares the nav key and places it in the league section', () => {
    expect(SHELL).toContain("| 'defense-hub'")
    expect(SHELL).toMatch(/keys: \[[^\]]*'defense-hub'[^\]]*\]/)
  })

  /**
   * 🛑 THE LOAD-BEARING ASSERTION. If the entry stops being gated on `hasIdpDefense`, every
   * non-IDP league gets a rail item that leads to a refusal.
   */
  it('gates the entry on the league actually scoring IDP', () => {
    expect(SHELL).toContain('hasIdpDefense')
    expect(SHELL).toMatch(/props\.hasIdpDefense && props\.selectedLeagueId/)
  })

  it('links into the league, not to a bare screen', () => {
    expect(SHELL).toMatch(/\/core\/defense-hub\?league=\$\{encodeURIComponent\(props\.selectedLeagueId\)\}/)
  })
})

describe('/core Defense Hub screen', () => {
  it('maps the segment and renders the existing hub client', () => {
    expect(PAGE).toMatch(/'defense-hub': 'defense-hub'/)
    expect(PAGE).toContain('<DefenseHubClient leagueId={selectedLeagueId} embedded />')
  })

  /**
   * ⚠ REUSES THE HUB CLIENT RATHER THAN REIMPLEMENTING IT. A second copy would drift from the
   * standalone page, and the kicker section, coverage banner and blocked states would have to
   * be maintained twice.
   */
  it('does not reimplement the hub', () => {
    expect(PAGE).not.toMatch(/function\s+DefenseHub\b/)
    expect(PAGE).toContain("from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'")
  })

  it('resolves eligibility on the server so the rail does not flicker', () => {
    expect(PAGE).toContain('resolveLeagueValueSurfaces')
    expect(PAGE).toContain('hasIdpDefense={hasIdpDefense}')
  })

  /**
   * ⚠ NO NEW ROUTE. `/core/[[...screen]]` is a catch-all, so a screen is a segment rather than
   * a route file. The repo sits at Vercel's 2048-route ceiling and the rail's own comments say
   * five sibling routes for five screens is what pushed it there.
   */
  it('rides the catch-all rather than adding a route file', () => {
    let added = false
    try {
      readFileSync(resolve(process.cwd(), 'app/core/defense-hub/page.tsx'), 'utf8')
      added = true
    } catch {
      /* expected: no sibling route file */
    }
    expect(added).toBe(false)
  })
})
