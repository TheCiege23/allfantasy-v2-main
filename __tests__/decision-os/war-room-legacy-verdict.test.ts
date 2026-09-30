// @vitest-environment node
/**
 * The War Rooms' retired accept / reject / neutral rule lives in Decision OS, and ONLY feeds the shadow.
 *
 * Since 2026-09-28/29 every War Room shows the one grade (`warRoomTradeGrade.ts`); the five engines'
 * own verdict survived only as shadow telemetry (`warRoomShadow.ts`). It was still computed INSIDE
 * each engine, so `lib/redraft-war-room/redraftTradeEngine.ts#analyzeTrade` returned a verdict from
 * outside `lib/decision-os/<domain>/` and tripped the Decision Engine Boundary guard. The engines now
 * return facts and inputs only; the rule is here, and the shadow derives it. These pin:
 *   1. the rule itself, unchanged from what the five engines computed (thresholds, keeper term,
 *      abstention, disabled);
 *   2. the shadow records the same verdict string from the engines' inputs as it did from their
 *      verdict field — so the flip-readiness rollup does not silently change meaning;
 *   3. the guard reports no War Room file, with a still-listed violation as the positive control.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ recorded: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/decision-os/trade/surfaceShadow', () => ({
  recordTradeSurfaceShadow: vi.fn((row: Record<string, unknown>) => h.recorded.push(row)),
}))

import { warRoomLegacyVerdict } from '@/lib/decision-os/trade/warRoomLegacyVerdict'
import { recordWarRoomTradeShadow } from '@/lib/decision-os/trade/warRoomShadow'

beforeEach(() => {
  h.recorded = []
})

describe('warRoomLegacyVerdict — the rule the five engines used to compute', () => {
  it('composite = valueDelta + 1.5 × rosterFitDelta; ≥ 3 accept, ≤ −3 reject, else neutral', () => {
    expect(warRoomLegacyVerdict({ valueDelta: 3, rosterFitDelta: 0 })).toBe('accept')
    expect(warRoomLegacyVerdict({ valueDelta: 0, rosterFitDelta: 2 })).toBe('accept')
    expect(warRoomLegacyVerdict({ valueDelta: 2.99, rosterFitDelta: 0 })).toBe('neutral')
    expect(warRoomLegacyVerdict({ valueDelta: -2.99, rosterFitDelta: 0 })).toBe('neutral')
    expect(warRoomLegacyVerdict({ valueDelta: -3, rosterFitDelta: 0 })).toBe('reject')
    expect(warRoomLegacyVerdict({ valueDelta: 1, rosterFitDelta: -3 })).toBe('reject')
  })

  it('the keeper engine’s surplus term is part of the composite', () => {
    expect(warRoomLegacyVerdict({ valueDelta: 1, rosterFitDelta: 0 })).toBe('neutral')
    expect(warRoomLegacyVerdict({ valueDelta: 1, rosterFitDelta: 0, keeperSurplusDelta: 2 })).toBe('accept')
    expect(warRoomLegacyVerdict({ valueDelta: 1, rosterFitDelta: 0, keeperSurplusDelta: -4 })).toBe('reject')
  })

  it('abstains when no value signal exists — a fit delta alone is never a verdict', () => {
    expect(warRoomLegacyVerdict({ valueDelta: null, rosterFitDelta: 5 })).toBe('needs_more_data')
  })

  it('a league with trades off is disabled, whatever the inputs', () => {
    expect(warRoomLegacyVerdict({ valueDelta: 9, rosterFitDelta: 2, tradesEnabled: false })).toBe('disabled')
    expect(warRoomLegacyVerdict({ valueDelta: 9, rosterFitDelta: 2, tradesEnabled: true })).toBe('accept')
  })
})

describe('recordWarRoomTradeShadow derives the legacy verdict from the engine’s inputs', () => {
  const base = { format: 'redraft' as const, leagueId: 'L1', rosterId: 'r1', outgoingCount: 1, incomingCount: 1 }

  it('🛑 an analysis with no verdict field still records the verdict the engine used to return', () => {
    recordWarRoomTradeShadow({ ...base, analysis: { valueDelta: 5, rosterFitDelta: 0 } })
    expect(h.recorded).toHaveLength(1)
    expect(h.recorded[0]).toMatchObject({
      surface: 'warroom_redraft',
      surfaceVerdict: 'accept',
      surfaceValueDeltaPct: 5,
      surfaceAnalysisMode: 'warroom_composite_verdict',
    })
  })

  it('🛑 keeper surplus reaches the recorded verdict', () => {
    recordWarRoomTradeShadow({ ...base, format: 'keeper', analysis: { valueDelta: 1, rosterFitDelta: 0, keeperSurplusDelta: 2 } })
    expect(h.recorded[0]).toMatchObject({ surface: 'warroom_keeper', surfaceVerdict: 'accept' })
  })

  it('🛑 trades off records disabled, as an abstention', () => {
    recordWarRoomTradeShadow({ ...base, format: 'guillotine', tradesEnabled: false, analysis: { valueDelta: null, rosterFitDelta: 0 } })
    expect(h.recorded[0]).toMatchObject({ surfaceVerdict: 'disabled', surfaceAnalysisMode: 'warroom_abstained' })
  })

  it('no value signal records needs_more_data, as an abstention', () => {
    recordWarRoomTradeShadow({ ...base, analysis: { valueDelta: null, rosterFitDelta: 3 } })
    expect(h.recorded[0]).toMatchObject({ surfaceVerdict: 'needs_more_data', surfaceAnalysisMode: 'warroom_abstained' })
  })
})

describe('the War Room AI prompts carry no private verdict or scale', () => {
  // Comments stripped, so the sentence explaining the removal cannot satisfy or break the check.
  const code = (rel: string) =>
    readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const PRIVATE = /verdict=|tradeAnalysis\.verdict|valueDelta=|rosterFitDelta=/

  it.each([
    'lib/redraft-war-room/redraftWarRoomPrompt.ts',
    'lib/dynasty-war-room/dynastyWarRoomPrompt.ts',
    'lib/keeper-war-room/keeperWarRoomPrompt.ts',
    'lib/guillotine-war-room/guillotineWarRoomPrompt.ts',
    'lib/best-ball-war-room/bestBallWarRoomPrompt.ts',
  ])('%s', (file) => {
    const src = code(file)
    expect(src).toMatch(/=== DETERMINISTIC TRADE ANALYSIS ===/) // the section still exists — facts only
    expect(src).not.toMatch(PRIVATE)
  })

  it('positive control: the shape matches the line the prompts wrote', () => {
    expect(PRIVATE.test("lines.push(`verdict=${inputs.tradeAnalysis.verdict} valueDelta=${inputs.tradeAnalysis.valueDelta ?? 'n/a'}`)")).toBe(true)
  })
})

describe('Decision Engine Boundary — no War Room engine exports a verdict', () => {
  const scan = () =>
    execFileSync(process.execPath, ['scripts/check-decision-engine-boundary.mjs'], { cwd: process.cwd(), encoding: 'utf8' })

  it('[control] the full scan runs and still lists a known backlog entry', () => {
    // If this stops holding because that entry was fixed, pick another listed one — the point is that
    // an empty War Room result below comes from a scan that could see a violation.
    // Was pick-valuation.ts analyzeTrade until that dead function was deleted (2026-09-30).
    expect(scan()).toMatch(/lib\/dynasty-tiers\.ts:\d+ {2}evaluateTrade {2}\[trade\]/)
  })

  it('🛑 the full scan lists no file under lib/*-war-room/', () => {
    expect(scan().split(/\r?\n/).filter((l) => /^- lib\/[a-z-]*war-room\//.test(l))).toEqual([])
  }, 60_000)
})
