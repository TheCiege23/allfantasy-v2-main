// @vitest-environment node
/**
 * The daily portfolio value record is wired into /api/cron/domain-os-refresh as a sixth writer
 * (2026-09-16). The /core/portfolio value chart draws a stored day as "recorded" and falls back to a
 * reconstruction otherwise, so a writer that stopped would degrade silently to estimates.
 *
 * ⚠ A SOURCE CONTRACT, like the rankings-snapshot wiring test: the route imports the whole Decision
 * OS feed stack. The writer's behaviour is covered in core-app/portfolioInsightsSummary.test.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'app/api/cron/domain-os-refresh/route.ts'), 'utf8')

describe('domain-os-refresh → portfolio daily totals wiring', () => {
  it('🛑 runs LAST, on the shared budget, and cannot fail the run', () => {
    const at = src.indexOf('counts.portfolio = await runPortfolioDailyTotals(new Date(), { budget })')
    const odds = src.indexOf('counts.odds = await runMatchupOddsSweep({ budget })')
    expect(at).toBeGreaterThan(odds)
    expect(src.slice(at, at + 300)).toMatch(/\.catch\(\(e: unknown\) => \{\s*const out = emptyPortfolioTotalsCounts\(\)\s*out\.failed = 1/)
    expect(src).toMatch(/portfolio: emptyPortfolioTotalsCounts\(\),/)
  })

  it('🛑 its writes, errors, failures and deferrals reach the run telemetry', () => {
    expect(src).toMatch(/\+ r\.snapshot\.written \+ r\.portfolio\.written/)
    expect(src).toMatch(/\.\.\.r\.portfolio\.errors,/)
    expect(src).toMatch(/r\.portfolio\.failed > 0/)
    expect(src).toMatch(/r\.portfolio\.deferred/)
    expect(src).toMatch(/portfolio: \{\s*date: r\.portfolio\.date,\s*considered: r\.portfolio\.considered,\s*written: r\.portfolio\.written,/)
  })

  it('imports the summary module, whose graph is Postgres-only', () => {
    expect(src).toMatch(/from '@\/lib\/core-app\/portfolioInsightsSummary'/)
  })
})
