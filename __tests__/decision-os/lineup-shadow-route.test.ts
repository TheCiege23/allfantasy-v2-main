import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Source-contract test for the shadow mount in /api/today/lineup-actions. The route is too
 * dependency-heavy (next-auth + prisma) for a cheap runtime render; the shadow runner's behavior is
 * unit-tested in lineup-shadow.test.ts. Here we lock the WIRING: shadow is flag-gated, isolated, and
 * the legacy response is unchanged.
 */
const route = readFileSync(resolve(process.cwd(), 'app/api/today/lineup-actions/route.ts'), 'utf8')

describe('shadow-mount wiring: /api/today/lineup-actions', () => {
  it('imports + invokes the Decision OS shadow runner', () => {
    expect(route).toContain("from '@/lib/decision-os/lineup/shadow'")
    expect(route).toContain('runLineupShadowForSummary')
  })

  it('is gated by the DECISION_OS_LINEUP_SHADOW flag', () => {
    expect(route).toMatch(/shouldRunLineupShadow\(process\.env/)
  })

  it('is isolated in try/catch so the shadow can never break the legacy response', () => {
    // the shadow block must be wrapped in try/catch
    const idx = route.indexOf('shouldRunLineupShadow(process.env')
    const block = route.slice(idx, idx + 400)
    expect(block).toMatch(/try\s*\{/)
    expect(block).toMatch(/catch/)
  })

  it('legacy response fields (withChimmy + intelligence) always present; decisionOs is optional', () => {
    // Stage 1: decisionOs is spread in optionally — withChimmy and intelligence are always present
    expect(route).toContain('...withChimmy')
    expect(route).toContain('intelligence')
    // the returned payload must never include raw shadow output
    expect(route).not.toMatch(/NextResponse\.json\([^)]*shadow/i)
  })

  it('still computes the legacy summary via the canonical recommender (untouched)', () => {
    expect(route).toContain('computeLineupActionsForUser(userId)')
    expect(route).toContain('attachChimmyAdviceToLineupSummary(summary, userId)')
  })
})
