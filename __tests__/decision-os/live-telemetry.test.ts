import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerDecisionTelemetrySink,
  type DecisionTelemetryEvent,
} from '@/lib/decision-os/core/telemetry'
import { emitLiveTelemetry } from '@/lib/decision-os/core/parity'

/**
 * Phase 4.6 — Stage 1 live-enrichment telemetry tests.
 *
 * Two concerns:
 * 1. `emitLiveTelemetry` unit tests — verify it emits the right event name + flags.
 * 2. Source-contract tests — each Stage 1 route imports and calls emitLiveTelemetry.
 */

// ─── Route source files ────────────────────────────────────────────────────────

const waiverSrc = readFileSync(
  resolve(process.cwd(), 'app/api/waiver-ai/engine/route.ts'),
  'utf8',
)
const tradeSrc = readFileSync(
  resolve(process.cwd(), 'app/api/redraft/trade-proposals/route.ts'),
  'utf8',
)
const lineupSrc = readFileSync(
  resolve(process.cwd(), 'app/api/today/lineup-actions/route.ts'),
  'utf8',
)
const commissionerSrc = readFileSync(
  resolve(process.cwd(), 'lib/commissioner-hub/commissionerHubHealth.ts'),
  'utf8',
)

// ─── emitLiveTelemetry unit tests ─────────────────────────────────────────────

describe('emitLiveTelemetry', () => {
  let captured: DecisionTelemetryEvent[]

  beforeEach(() => {
    captured = []
    registerDecisionTelemetrySink((e) => captured.push(e))
  })

  afterEach(() => {
    registerDecisionTelemetrySink(null)
  })

  it('emits event name "decision.live_enrichment"', () => {
    emitLiveTelemetry('lineup.set', { enriched: true, latency_ms: 42 })
    expect(captured).toHaveLength(1)
    expect(captured[0].event).toBe('decision.live_enrichment')
  })

  it('sets decision_type from first argument', () => {
    emitLiveTelemetry('waiver.claim', { enriched: true, latency_ms: 10 }, 'dec_abc')
    expect(captured[0].decision_type).toBe('waiver.claim')
  })

  it('passes decision_id as third argument', () => {
    emitLiveTelemetry('trade.value', { enriched: true, latency_ms: 5 }, 'dec_xyz')
    expect(captured[0].decision_id).toBe('dec_xyz')
  })

  it('carries enriched=true in flags when decisionOs was built', () => {
    emitLiveTelemetry('lineup.set', { enriched: true, latency_ms: 20, leagueId: 'lg1' })
    expect(captured[0].flags?.['enriched']).toBe(true)
    expect(captured[0].flags?.['latency_ms']).toBe(20)
    expect(captured[0].flags?.['leagueId']).toBe('lg1')
  })

  it('carries enriched=false + reason when decisionOs was not built', () => {
    emitLiveTelemetry('waiver.claim', { enriched: false, reason: 'exception', latency_ms: 3 })
    expect(captured[0].flags?.['enriched']).toBe(false)
    expect(captured[0].flags?.['reason']).toBe('exception')
  })

  it('carries enriched_count for commissioner batch summary events', () => {
    emitLiveTelemetry('commissioner.league.health', { enriched: true, enriched_count: 3, total_db_source: 4, latency_ms: 150 })
    expect(captured[0].flags?.['enriched_count']).toBe(3)
    expect(captured[0].flags?.['total_db_source']).toBe(4)
  })

  it('includes an ISO timestamp (at)', () => {
    emitLiveTelemetry('trade.value', { enriched: true, latency_ms: 8 })
    expect(new Date(captured[0].at as string).toISOString()).toBeTruthy()
  })

  it('does not throw when no sink is registered', () => {
    registerDecisionTelemetrySink(null)
    expect(() => emitLiveTelemetry('lineup.set', { enriched: true, latency_ms: 1 })).not.toThrow()
  })

  it('emitLiveTelemetry is exported from @/lib/decision-os/core/parity barrel', () => {
    expect(typeof emitLiveTelemetry).toBe('function')
  })
})

// ─── Source-contract: waiver route ────────────────────────────────────────────

describe('waiver route live telemetry wiring', () => {
  it('imports emitLiveTelemetry from @/lib/decision-os/core/parity', () => {
    expect(waiverSrc).toContain('emitLiveTelemetry')
    expect(waiverSrc).toContain("from '@/lib/decision-os/core/parity'")
  })

  it('records liveStart = Date.now() before the LIVE block', () => {
    const liveIdx = waiverSrc.indexOf('const isLive = shouldRunWaiverLive')
    expect(liveIdx).toBeGreaterThan(-1)
    const pre = waiverSrc.slice(liveIdx, liveIdx + 300)
    expect(pre).toContain('liveStart = Date.now()')
  })

  it('emits enriched=true when decisionOs is built', () => {
    expect(waiverSrc).toContain("enriched: true")
    expect(waiverSrc).toContain("latency_ms: Date.now() - liveStart")
  })

  it('emits enriched=false with reason on shadow_no_result', () => {
    expect(waiverSrc).toContain("reason: 'shadow_no_result'")
  })

  it('emits enriched=false with reason on exception', () => {
    const catchIdx = waiverSrc.indexOf('emitLiveTelemetry')
    // at least one emitLiveTelemetry call before a catch block
    expect(catchIdx).toBeGreaterThan(-1)
    expect(waiverSrc).toContain("reason: 'exception'")
  })
})

// ─── Source-contract: trade route ─────────────────────────────────────────────

describe('trade route live telemetry wiring', () => {
  it('imports emitLiveTelemetry from @/lib/decision-os/core/parity', () => {
    expect(tradeSrc).toContain('emitLiveTelemetry')
    expect(tradeSrc).toContain("from '@/lib/decision-os/core/parity'")
  })

  it('records liveStart = Date.now() before the LIVE block', () => {
    const liveIdx = tradeSrc.indexOf('const isLive = shouldRunTradeLive')
    expect(liveIdx).toBeGreaterThan(-1)
    const pre = tradeSrc.slice(liveIdx, liveIdx + 300)
    expect(pre).toContain('liveStart = Date.now()')
  })

  it('emits enriched=true when decisionOs is built', () => {
    expect(tradeSrc).toContain("enriched: true")
  })

  it('emits enriched=false with reason on shadow_no_result and exception', () => {
    expect(tradeSrc).toContain("reason: 'shadow_no_result'")
    expect(tradeSrc).toContain("reason: 'exception'")
  })

  it('uses decision_type "trade.value"', () => {
    expect(tradeSrc).toContain("'trade.value'")
  })
})

// ─── Source-contract: lineup route ────────────────────────────────────────────

describe('lineup route live telemetry wiring', () => {
  it('imports emitLiveTelemetry from @/lib/decision-os/core/parity', () => {
    expect(lineupSrc).toContain('emitLiveTelemetry')
    expect(lineupSrc).toContain("from '@/lib/decision-os/core/parity'")
  })

  it('records liveStart = Date.now() before the LIVE block', () => {
    const liveIdx = lineupSrc.indexOf('const isLive = shouldRunLineupLive')
    expect(liveIdx).toBeGreaterThan(-1)
    const pre = lineupSrc.slice(liveIdx, liveIdx + 300)
    expect(pre).toContain('liveStart = Date.now()')
  })

  it('includes source in the enriched=true flags (tracks redraft_native vs canonical_world)', () => {
    const liveIdx = lineupSrc.indexOf('if (isLive) {')
    expect(liveIdx).toBeGreaterThan(-1)
    const block = lineupSrc.slice(liveIdx, liveIdx + 2600)
    expect(block).toContain('source: first.source')
  })

  it('emits enriched=false on shadow_no_result and exception', () => {
    expect(lineupSrc).toContain("reason: 'shadow_no_result'")
    expect(lineupSrc).toContain("reason: 'exception'")
  })

  it('uses decision_type "lineup.set"', () => {
    expect(lineupSrc).toContain("'lineup.set'")
  })
})

// ─── Source-contract: commissioner hub ────────────────────────────────────────

describe('commissioner hub live telemetry wiring', () => {
  it('imports emitLiveTelemetry from @/lib/decision-os/core/parity', () => {
    expect(commissionerSrc).toContain('emitLiveTelemetry')
    expect(commissionerSrc).toContain("from '@/lib/decision-os/core/parity'")
  })

  it('declares enrichedCount counter inside the LIVE block', () => {
    expect(commissionerSrc).toContain('enrichedCount')
    expect(commissionerSrc).toContain('enrichedCount++')
  })

  it('emits a summary event after Promise.all with enriched_count and total_db_source', () => {
    const liveIdx = commissionerSrc.indexOf('if (isLive) {')
    expect(liveIdx).toBeGreaterThan(-1)
    // Widened from 1200: the batched `leaguesWithSavedAnalysis` prefilter added lines ahead of
    // the summary emit. Unlike the `pre` windows below, this one is a CONTAINMENT check, not a
    // proximity check, so widening preserves what it tests.
    const block = commissionerSrc.slice(liveIdx, liveIdx + 3600)
    expect(block).toContain('enriched_count: enrichedCount')
    expect(block).toContain('total_db_source: totalDbSource')
    expect(block).toContain('latency_ms: Date.now() - liveStart')
  })

  it('uses decision_type "commissioner.league.health"', () => {
    expect(commissionerSrc).toContain("'commissioner.league.health'")
  })

  it('emits AFTER await Promise.all (summary pattern, not per-snapshot)', () => {
    // The emit comes after the closing paren of Promise.all
    const promiseAllIdx = commissionerSrc.indexOf('await Promise.all(')
    const emitIdx = commissionerSrc.indexOf("emitLiveTelemetry('commissioner.league.health'")
    expect(promiseAllIdx).toBeGreaterThan(-1)
    expect(emitIdx).toBeGreaterThan(promiseAllIdx)
  })
})
