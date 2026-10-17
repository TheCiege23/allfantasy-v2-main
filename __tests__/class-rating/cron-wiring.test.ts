// @vitest-environment node
/**
 * The Class rating rides /api/cron/domain-os-refresh as its eighth writer (ADR F2.10a, 2026-10-01).
 *
 * ⚠ A SOURCE CONTRACT, like domain-os-refresh-rankings-snapshot-wiring: the route imports the whole
 * Decision OS feed stack, so these pin the wiring by reading the file. Behaviour is covered in
 * run.test.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
const src = read('app/api/cron/domain-os-refresh/route.ts')
const staticImports = (file: string) =>
  [...read(file).matchAll(/^import (?:type )?[^'";]*? from '([^']+)'/gm)].map((m) => m[1]).sort()

describe('domain-os-refresh → Class rating wiring', () => {
  it('🛑 runs BEFORE the league walk, whose early return would otherwise skip it, and cannot throw out', () => {
    const at = src.indexOf('counts.classRating = await runClassRatingDaily(')
    const walkReturn = src.indexOf('if (leagues.length === 0) return counts')
    expect(at).toBeGreaterThan(0)
    expect(walkReturn).toBeGreaterThan(at)
    expect(src.slice(at, at + 400)).toMatch(/\.catch\(\s*\(e: unknown\) => \{\s*const out = emptyClassRatingCounts\(\)\s*out\.failed = 1/)
    expect(src).toMatch(/classRating: emptyClassRatingCounts\(\),/)
  })

  it('takes its time from the fire’s own budget', () => {
    expect(src).toMatch(/runClassRatingDaily\(new Date\(\), \{ remainingMs: \(\) => budget\.remainingMs\(\) \}\)/)
  })

  it('🛑 its errors and failures reach the run telemetry', () => {
    expect(src).toMatch(/\.\.\.r\.outlook\.errors, \.\.\.r\.classRating\.errors\]/)
    expect(src).toMatch(/r\.classRating\.failed > 0/)
    expect(src).toMatch(/classRating: \{\s*date: r\.classRating\.date,\s*skipped: r\.classRating\.skipped,\s*rebuilt: r\.classRating\.rebuilt,/)
  })

  it('🛑 keeps the cron’s import graph lean — no module that can load lib/auth.ts', () => {
    // The route's own rule (see rankingsCommunity.ts): a worker env without NEXTAUTH_SECRET must not
    // be able to take the whole cron down at module load.
    expect(staticImports('lib/class-rating/run.ts')).toEqual([
      '@/lib/class-rating/engine',
      '@/lib/class-rating/inputs',
      '@/lib/class-rating/recap',
      '@/lib/class-rating/store',
    ])
    // The weekly recap (ported from #1753) loads the notification dispatcher DYNAMICALLY, at send time.
    expect(staticImports('lib/class-rating/recap.ts')).toEqual([
      '@/lib/class-rating/engine',
      '@/lib/class-rating/store',
      '@/lib/prisma',
      '@prisma/client',
    ])
    expect(staticImports('lib/class-rating/store.ts')).toEqual([
      '@/lib/class-rating/engine',
      '@/lib/class-rating/inputs',
      '@/lib/prisma',
      '@prisma/client',
      'node:crypto',
    ])
    expect(staticImports('lib/class-rating/inputs.ts')).toEqual([
      '@/lib/class-rating/engine',
      '@/lib/core-app/seasonTimeline',
      'node:crypto',
    ])
    expect(staticImports('lib/class-rating/engine.ts')).toEqual([])
    expect(staticImports('lib/core-app/seasonTimeline.ts')).toEqual([])
  })
})
