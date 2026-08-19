import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { shouldRunTradeLive } from '@/lib/decision-os/trade/shadow'

/**
 * Stage 1 source-contract + flag-gate tests for the Trade LIVE kill switch.
 *
 * Two concerns:
 * 1. `shouldRunTradeLive` gate — unit tested here (no DB, no route deps).
 * 2. LIVE wiring in app/api/redraft/trade-proposals/route.ts — source-contract tested by
 *    reading the file. The route is DB-heavy; shadow runner behavior is in trade-shadow.test.ts.
 */
const routeSrc = readFileSync(
  resolve(process.cwd(), 'app/api/redraft/trade-proposals/route.ts'),
  'utf8',
)

describe('shouldRunTradeLive (Stage 1 kill switch)', () => {
  it('true only when DECISION_OS_TRADE_LIVE=true', () => {
    expect(shouldRunTradeLive({ DECISION_OS_TRADE_LIVE: 'true' } as never)).toBe(true)
    expect(shouldRunTradeLive({ DECISION_OS_TRADE_LIVE: 'TRUE' } as never)).toBe(true)
    expect(shouldRunTradeLive({ DECISION_OS_TRADE_LIVE: 'false' } as never)).toBe(false)
    expect(shouldRunTradeLive({} as never)).toBe(false)
  })

  it('kill switch: returns false when env var is unset (instant rollback)', () => {
    expect(shouldRunTradeLive({} as never)).toBe(false)
  })

  it('does not accept the shadow env var as live (flags are independent)', () => {
    expect(shouldRunTradeLive({ DECISION_OS_TRADE_SHADOW: 'true' } as never)).toBe(false)
  })

  it('is not scope-filtered — live is unconditional for all proposals with a snapshot', () => {
    expect(typeof shouldRunTradeLive).toBe('function')
    expect(shouldRunTradeLive.length).toBeLessThanOrEqual(1) // only env param, no scope
  })
})

describe('trade-proposals route Stage 1 wiring', () => {
  it('imports shouldRunTradeLive from the shadow module', () => {
    expect(routeSrc).toContain('shouldRunTradeLive')
    expect(routeSrc).toContain("from '@/lib/decision-os/trade/shadow'")
  })

  it('imports toTradeCard for card rendering', () => {
    expect(routeSrc).toContain('toTradeCard')
    expect(routeSrc).toContain("from '@/lib/decision-os/trade/tradeCardAdapter'")
  })

  it('gates the LIVE path with shouldRunTradeLive(process.env)', () => {
    expect(routeSrc).toMatch(/shouldRunTradeLive\(process\.env\)/)
  })

  it('LIVE path builds decisionOs from all four required fields', () => {
    // Anchor to the branch itself so the shadowArgs declaration doesn't eat the window.
    const liveIdx = routeSrc.indexOf('if (isLive && shadowArgs)')
    expect(liveIdx).toBeGreaterThan(-1)
    const liveBlock = routeSrc.slice(liveIdx, liveIdx + 900)
    expect(liveBlock).toContain('decisionId: decision.decision_id')
    expect(liveBlock).toContain('card: toTradeCard(decision)')
    expect(liveBlock).toContain('completeness: decision.data_completeness')
    expect(liveBlock).toContain('uncertaintySources: decision.uncertainty_sources')
  })

  it('LIVE path is isolated in try/catch so a Decision OS failure never breaks the route', () => {
    const liveIdx = routeSrc.indexOf('if (isLive && shadowArgs)')
    expect(liveIdx).toBeGreaterThan(-1)
    const liveBlock = routeSrc.slice(liveIdx, liveIdx + 900)
    expect(liveBlock).toMatch(/try\s*\{/)
    expect(liveBlock).toMatch(/catch/)
  })

  it('decisionOs is only built when the shadow ran and has a result', () => {
    expect(routeSrc).toContain('liveResult.ran && liveResult.result')
  })

  it('no snapshot = no Decision OS (shadowArgs guards both paths)', () => {
    // shadowArgs is null when created?.id or snapshotRow is absent — both LIVE and SHADOW skip
    expect(routeSrc).toContain('created?.id && snapshotRow')
    expect(routeSrc).toContain('shadowArgs')
  })

  it('response spreads decisionOs when present, omits it when null', () => {
    expect(routeSrc).toContain('...(decisionOs ? { decisionOs } : {})')
  })

  it('legacy fields (proposal + valueSnapshot) are always in the response', () => {
    expect(routeSrc).toContain('proposal: created')
    expect(routeSrc).toContain('valueSnapshot: snapshotRow')
  })

  it('Stage 0 shadow-only path still exists in else branch (existing behavior preserved)', () => {
    expect(routeSrc).toContain('shouldRunTradeShadow(process.env')
  })
})
