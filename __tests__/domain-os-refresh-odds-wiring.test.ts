// @vitest-environment node
/**
 * The pre-game odds snapshot is wired into /api/cron/domain-os-refresh as a fourth writer
 * (2026-09-14): run LAST on the shared budget, its own counts in the telemetry, a failure downgrades
 * the run, and a thrown sweep never fails the fire.
 *
 * ⚠ A SOURCE CONTRACT: the route imports the whole Decision OS feed stack, and the sweep itself is
 * tested for behaviour in matchup-odds-sweep.test.ts. This pins the wiring that connects them.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'app/api/cron/domain-os-refresh/route.ts'), 'utf8')

describe('domain-os-refresh → matchup odds sweep wiring', () => {
  it('🛑 runs after the forecast sweep, on the shared budget, and a throw becomes a counted failure', () => {
    const forecastAt = src.indexOf('counts.forecast = await runForecastSweep({ budget })')
    const oddsAt = src.indexOf('counts.odds = await runMatchupOddsSweep({ budget })')
    expect(forecastAt).toBeGreaterThan(0)
    expect(oddsAt).toBeGreaterThan(forecastAt)
    expect(src.slice(oddsAt, oddsAt + 400)).toMatch(/\.catch\(\(e: unknown\) => \{\s*const out = emptyMatchupOddsSweepCounts\(\)\s*out\.failed = 1/)
    expect(src).toMatch(/odds: emptyMatchupOddsSweepCounts\(\),/)
  })

  it('🛑 its rows, skips, errors and failures reach the run telemetry', () => {
    expect(src).toMatch(/rowsWritten: r\.written \+ r\.rankings\.written \+ r\.forecast\.written \+ r\.odds\.written[ ,]/)
    expect(src).toMatch(/r\.odds\.skippedForTime,/)
    expect(src).toMatch(/\.\.\.r\.forecast\.errors, \.\.\.r\.odds\.errors[\],]/)
    expect(src).toMatch(/r\.forecast\.failed > 0 \|\| r\.odds\.failed > 0/)
    expect(src).toMatch(/odds: \{\s*outsideWindow: r\.odds\.outsideWindow,\s*unavailable: r\.odds\.unavailable,/)
  })
})
