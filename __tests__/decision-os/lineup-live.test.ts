import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { shouldRunLineupLive } from '@/lib/decision-os/lineup/shadow'

/**
 * Stage 1 source-contract + flag-gate tests for the Lineup LIVE kill switch.
 *
 * Two concerns:
 * 1. `shouldRunLineupLive` gate — unit tested here (no DB, no route deps).
 * 2. LIVE wiring in app/api/today/lineup-actions/route.ts — source-contract tested by
 *    reading the file. Shadow runner behavior is in lineup-shadow.test.ts.
 */
const routeSrc = readFileSync(
  resolve(process.cwd(), 'app/api/today/lineup-actions/route.ts'),
  'utf8',
)

describe('shouldRunLineupLive (Stage 1 kill switch)', () => {
  it('true only when DECISION_OS_LINEUP_LIVE=true', () => {
    expect(shouldRunLineupLive({ DECISION_OS_LINEUP_LIVE: 'true' } as never)).toBe(true)
    expect(shouldRunLineupLive({ DECISION_OS_LINEUP_LIVE: 'TRUE' } as never)).toBe(true)
    expect(shouldRunLineupLive({ DECISION_OS_LINEUP_LIVE: 'false' } as never)).toBe(false)
    expect(shouldRunLineupLive({} as never)).toBe(false)
  })

  it('kill switch: returns false when env var is unset (instant rollback)', () => {
    expect(shouldRunLineupLive({} as never)).toBe(false)
  })

  it('does not accept the shadow env var as live (flags are independent)', () => {
    expect(shouldRunLineupLive({ DECISION_OS_LINEUP_SHADOW: 'true' } as never)).toBe(false)
  })

  it('is not scope-filtered — live is unconditional (no leagueId or username filter)', () => {
    expect(typeof shouldRunLineupLive).toBe('function')
    expect(shouldRunLineupLive.length).toBeLessThanOrEqual(1) // only env param, no scope
  })
})

describe('lineup route Stage 1 wiring', () => {
  it('imports shouldRunLineupLive from the shadow module', () => {
    expect(routeSrc).toContain('shouldRunLineupLive')
    expect(routeSrc).toContain("from '@/lib/decision-os/lineup/shadow'")
  })

  it('imports toTodayLineupCard for card rendering', () => {
    expect(routeSrc).toContain('toTodayLineupCard')
    expect(routeSrc).toContain("from '@/lib/decision-os/lineup/todayCardAdapter'")
  })

  it('gates the LIVE path with shouldRunLineupLive(process.env)', () => {
    expect(routeSrc).toMatch(/shouldRunLineupLive\(process\.env\)/)
  })

  it('LIVE path builds decisionOs from all four required fields', () => {
    const liveIdx = routeSrc.indexOf('if (isLive) {')
    expect(liveIdx).toBeGreaterThan(-1)
    const liveBlock = routeSrc.slice(liveIdx, liveIdx + 900)
    expect(liveBlock).toContain('decisionId: decision.decision_id')
    expect(liveBlock).toContain('toTodayLineupCard(decision)')
    expect(liveBlock).toContain('confidence: decision.confidence')
    expect(liveBlock).toContain('leagueId: first.leagueId')
  })

  it('LIVE path is isolated in try/catch so a Decision OS failure never breaks the route', () => {
    const liveIdx = routeSrc.indexOf('if (isLive) {')
    expect(liveIdx).toBeGreaterThan(-1)
    const liveBlock = routeSrc.slice(liveIdx, liveIdx + 900)
    expect(liveBlock).toMatch(/try\s*\{/)
    expect(liveBlock).toMatch(/catch/)
  })

  it('decisionOs is only built when the shadow ran and has a result', () => {
    expect(routeSrc).toContain('first?.ran && first.result')
  })

  it('reuses runLineupShadowForSummary — covers both redraft_native and canonical_world paths', () => {
    // Both Stage 0 and Stage 1 call runLineupShadowForSummary; internally it tries native then
    // canonical_world fallback, so imported and native leagues are both supported transparently.
    expect(routeSrc).toContain('runLineupShadowForSummary')
  })

  it('response spreads decisionOs when present, omits it when null', () => {
    expect(routeSrc).toContain('...(decisionOs ? { decisionOs } : {})')
  })

  it('legacy fields (withChimmy + intelligence) are always in the response', () => {
    expect(routeSrc).toContain('...withChimmy')
    expect(routeSrc).toContain('intelligence')
  })

  it('Stage 0 shadow-only path still exists in else branch (existing behavior preserved)', () => {
    expect(routeSrc).toContain('shouldRunLineupShadow(process.env')
  })
})
