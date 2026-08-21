import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { shouldRunWaiverLive } from '@/lib/decision-os/waiver/shadow'

/**
 * Stage 1 source-contract + flag-gate tests for the Waiver LIVE kill switch.
 *
 * Two concerns:
 * 1. `shouldRunWaiverLive` gate — unit tested here (no DB, no route deps).
 * 2. LIVE wiring in app/api/waiver-ai/engine/route.ts — source-contract tested by
 *    reading the file. The route is DB-heavy; shadow runner behavior is in waiver-shadow.test.ts.
 */
const routeSrc = readFileSync(
  resolve(process.cwd(), 'app/api/waiver-ai/engine/route.ts'),
  'utf8',
)

describe('shouldRunWaiverLive (Stage 1 kill switch)', () => {
  it('true only when DECISION_OS_WAIVER_LIVE=true', () => {
    expect(shouldRunWaiverLive({ DECISION_OS_WAIVER_LIVE: 'true' } as never)).toBe(true)
    expect(shouldRunWaiverLive({ DECISION_OS_WAIVER_LIVE: 'TRUE' } as never)).toBe(true)
    expect(shouldRunWaiverLive({ DECISION_OS_WAIVER_LIVE: 'false' } as never)).toBe(false)
    expect(shouldRunWaiverLive({} as never)).toBe(false)
  })

  it('kill switch: returns false when env var is unset (instant rollback)', () => {
    expect(shouldRunWaiverLive({} as never)).toBe(false)
  })

  it('does not accept the shadow env var as live (flags are independent)', () => {
    expect(shouldRunWaiverLive({ DECISION_OS_WAIVER_SHADOW: 'true' } as never)).toBe(false)
  })

  it('is not scope-filtered — live is unconditional for all requests with a leagueId', () => {
    expect(typeof shouldRunWaiverLive).toBe('function')
    expect(shouldRunWaiverLive.length).toBeLessThanOrEqual(1) // only env param, no scope
  })
})

describe('waiver engine route Stage 1 wiring', () => {
  it('imports shouldRunWaiverLive from the shadow module', () => {
    expect(routeSrc).toContain('shouldRunWaiverLive')
    expect(routeSrc).toContain("from '@/lib/decision-os/waiver/shadow'")
  })

  it('imports toWaiverCard for card rendering', () => {
    expect(routeSrc).toContain('toWaiverCard')
    expect(routeSrc).toContain("from '@/lib/decision-os/waiver/waiverCardAdapter'")
  })

  it('gates the LIVE path with shouldRunWaiverLive(process.env)', () => {
    expect(routeSrc).toMatch(/shouldRunWaiverLive\(process\.env\)/)
  })

  it('LIVE path builds decisionOs from all four required fields', () => {
    // Anchor to the branch itself so any preamble doesn't eat the window.
    const liveIdx = routeSrc.indexOf('if (isLive && input.leagueId)')
    expect(liveIdx).toBeGreaterThan(-1)
    // Window widened from 900: mounting `attachSavedAnalysis` in the LIVE block pushed both
    // `decisionId` and the surrounding catch past 900 chars, so this failed while the code
    // still did exactly what the test name claims. A fixed byte window is a fragile way to
    // assert structure -- it fails on insertion, not on regression.
    const liveBlock = routeSrc.slice(liveIdx, liveIdx + 2600)
    expect(liveBlock).toContain('decisionId: decision.decision_id')
    expect(liveBlock).toContain('toWaiverCard(attached.decision)')  // NOT toWaiverCard(decision): the card must
    // render the decision AFTER attachSavedAnalysis, or the AI explanation never reaches it.
    // This is the property worth pinning, and it is stronger than what this line asserted before.
    expect(liveBlock).toContain('confidence: card.confidence')
    expect(liveBlock).toContain('legal: card.legal')
  })

  it('LIVE path is isolated in try/catch so a Decision OS failure never breaks the route', () => {
    const liveIdx = routeSrc.indexOf('if (isLive && input.leagueId)')
    expect(liveIdx).toBeGreaterThan(-1)
    // Window widened from 900: mounting `attachSavedAnalysis` in the LIVE block pushed both
    // `decisionId` and the surrounding catch past 900 chars, so this failed while the code
    // still did exactly what the test name claims. A fixed byte window is a fragile way to
    // assert structure -- it fails on insertion, not on regression.
    const liveBlock = routeSrc.slice(liveIdx, liveIdx + 2600)
    expect(liveBlock).toMatch(/try\s*\{/)
    expect(liveBlock).toMatch(/catch/)
  })

  it('decisionOs is only built when the shadow ran and has a result', () => {
    expect(routeSrc).toContain('liveResult.ran && liveResult.result')
  })

  it('no leagueId = no Decision OS (leagueId guards both paths)', () => {
    expect(routeSrc).toContain('isLive && input.leagueId')
  })

  it('response spreads decisionOs when present, omits it when null', () => {
    expect(routeSrc).toContain('...(decisionOs ? { decisionOs } : {})')
  })

  it('legacy fields (success + analysis + tokenSpend) are always in the response', () => {
    expect(routeSrc).toContain('success: true')
    expect(routeSrc).toContain('analysis,')
    expect(routeSrc).toContain('tokenSpend: gate.tokenSpend')
  })

  it('Stage 0 shadow-only path still exists in else branch (existing behavior preserved)', () => {
    expect(routeSrc).toContain('shouldRunWaiverShadow(process.env')
  })
})
