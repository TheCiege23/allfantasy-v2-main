// @vitest-environment node
/**
 * The Season Outlook pre-compute is wired into /api/cron/domain-os-refresh as a seventh writer
 * (2026-09-17). Without it the page is still correct — its cache keys carry the inputs — but the first
 * visit after games are scored pays for the run.
 *
 * ⚠ A SOURCE CONTRACT, like the other wiring tests: the route imports the whole Decision OS feed
 * stack. The writer's behaviour is covered in core-app/seasonOutlookPrewarm.test.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'app/api/cron/domain-os-refresh/route.ts'), 'utf8')

describe('domain-os-refresh → Season Outlook pre-compute wiring', () => {
  it('🛑 runs after the portfolio writer, on the shared budget, and cannot fail the run', () => {
    const at = src.indexOf('counts.outlook = await runOutlookPrewarm(new Date(), { budget })')
    const portfolio = src.indexOf('counts.portfolio = await runPortfolioDailyTotals(new Date(), { budget })')
    expect(portfolio).toBeGreaterThan(0)
    expect(at).toBeGreaterThan(portfolio)
    expect(src.slice(at, at + 300)).toMatch(/\.catch\(\(e: unknown\) => \{\s*const out = emptyOutlookPrewarmCounts\(\)\s*out\.failed = 1/)
    expect(src).toMatch(/outlook: emptyOutlookPrewarmCounts\(\),/)
  })

  it('🛑 its runs, errors, failures and deferrals reach the run telemetry', () => {
    expect(src).toMatch(/\+ r\.portfolio\.written \+ r\.outlook\.computed,/)
    expect(src).toMatch(/\.\.\.r\.portfolio\.errors, \.\.\.r\.outlook\.errors\]/)
    expect(src).toMatch(/r\.outlook\.failed > 0/)
    expect(src).toMatch(/r\.outlook\.deferred \+/)
    /* `cooling` is how you tell "the queue is quiet" from "the cooldown is holding leagues back". */
    expect(src).toMatch(
      /outlook: \{\s*candidates: r\.outlook\.candidates,\s*due: r\.outlook\.due,\s*cooling: r\.outlook\.cooling,\s*computed: r\.outlook\.computed,\s*unchanged: r\.outlook\.unchanged,/,
    )
  })

  it('imports the pre-compute module, never the screen summary or the focus loader', () => {
    expect(src).toMatch(/from '@\/lib\/core-app\/seasonOutlookPrewarm'/)
    const prewarm = readFileSync(path.join(process.cwd(), 'lib/core-app/seasonOutlookPrewarm.ts'), 'utf8')
    const imports = [...prewarm.matchAll(/^import (?:type )?[^'";]*? from '([^']+)'/gm)].map((m) => m[1]).sort()
    expect(imports).toEqual(['./seasonOutlook', './seasonOutlookSims', '@/lib/prisma'])
  })
})
