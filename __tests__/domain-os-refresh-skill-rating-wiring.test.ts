// @vitest-environment node
/**
 * The per-game skill rating is wired into /api/cron/domain-os-refresh as an eighth writer
 * (2026-10-01). The Skill tab on /core/rankings reads ONLY what it stores, so a writer that stopped
 * running would freeze every rating with nothing red.
 *
 * ⚠ A SOURCE CONTRACT, like the other domain-os-refresh wiring tests: the route imports the whole
 * Decision OS feed stack. The rating's behaviour is covered in __tests__/rank/.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'app/api/cron/domain-os-refresh/route.ts'), 'utf8')

describe('domain-os-refresh → skill rating wiring', () => {
  it('🛑 runs BEFORE the league walk, whose early return would otherwise skip it', () => {
    const at = src.indexOf('const skill = await runSkillRatingDaily()')
    const walkReturn = src.indexOf('if (leagues.length === 0) return counts')
    expect(at).toBeGreaterThan(0)
    expect(walkReturn).toBeGreaterThan(at)
    expect(src.slice(at, at + 300)).toMatch(/\.catch\(\(e: unknown\) => \{\s*const out = emptySkillRatingCounts\(\)\s*out\.failed = 1/)
    expect(src).toMatch(/skill: \{ \.\.\.emptySkillRatingCounts\(\), deferred: 0 \},/)
  })

  it('🛑 checks "already done today" BEFORE the budget, so a busy fire cannot defer it forever', () => {
    const done = src.indexOf('await skillRatingWrittenToday()')
    const gate = src.indexOf('budget.remainingMs() >= SKILL_RATING_MIN_REMAINING_MS')
    expect(done).toBeGreaterThan(0)
    expect(gate).toBeGreaterThan(done)
  })

  it('🛑 its writes, deferrals, errors and failures reach the run telemetry', () => {
    expect(src).toMatch(/\+ r\.outlook\.computed \+ r\.skill\.written,/)
    expect(src).toMatch(/r\.skill\.deferred \+/)
    expect(src).toMatch(/\.\.\.r\.outlook\.errors, \.\.\.r\.skill\.errors\]/)
    expect(src).toMatch(/r\.skill\.failed > 0/)
    expect(src).toMatch(/skill: \{\s*date: r\.skill\.date,\s*written: r\.skill\.written,\s*alreadyWritten: r\.skill\.alreadyWritten,/)
  })

  it('🛑 the store module stays off the screen loader and lib/auth', () => {
    const store = readFileSync(path.join(process.cwd(), 'lib/rank/skillRating/skillRatingStore.ts'), 'utf8')
    const imports = [...store.matchAll(/^import (?:type )?[^'";]*? from '([^']+)'/gm)].map((m) => m[1]).sort()
    expect(imports).toEqual([
      '@/lib/core-app/rankingsEngine',
      '@/lib/prisma',
      '@/lib/rank/skillRating/loadRatedGames',
      '@/lib/rank/skillRating/replay',
      '@prisma/client',
    ])
  })
})
