// @vitest-environment node
/**
 * The daily community-rankings snapshot is wired into /api/cron/domain-os-refresh as a fifth writer
 * (2026-09-16). 7-day and weekly movement on /core/rankings are read ONLY from these snapshots, so a
 * writer that silently stopped running would leave every movement cell at "—" with nothing red.
 *
 * ⚠ A SOURCE CONTRACT, like domain-os-refresh-odds-wiring: the route imports the whole Decision OS
 * feed stack. The snapshot's behaviour is covered in core-rankings-snapshot.test.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'app/api/cron/domain-os-refresh/route.ts'), 'utf8')

describe('domain-os-refresh → rankings daily snapshot wiring', () => {
  it('🛑 runs BEFORE the league walk, whose early return would otherwise skip it', () => {
    const snapAt = src.indexOf('counts.snapshot = await runRankingsDailySnapshot()')
    const walkReturn = src.indexOf('if (leagues.length === 0) return counts')
    expect(snapAt).toBeGreaterThan(0)
    expect(walkReturn).toBeGreaterThan(snapAt)
    expect(src.slice(snapAt, snapAt + 300)).toMatch(/\.catch\(\(e: unknown\) => \{\s*const out = emptyRankingsSnapshotCounts\(\)\s*out\.failed = 1/)
    expect(src).toMatch(/snapshot: emptyRankingsSnapshotCounts\(\),/)
  })

  it('🛑 its writes, errors and failures reach the run telemetry', () => {
    expect(src).toMatch(/\+ r\.odds\.written \+ r\.snapshot\.written,/)
    expect(src).toMatch(/\.\.\.r\.odds\.errors, \.\.\.r\.snapshot\.errors\]/)
    expect(src).toMatch(/r\.snapshot\.failed > 0/)
    expect(src).toMatch(/snapshot: \{\s*date: r\.snapshot\.date,\s*written: r\.snapshot\.written,\s*alreadyWritten: r\.snapshot\.alreadyWritten,/)
  })

  it('🛑 imports the lean community module, never the screen loader', () => {
    // The screen loader reaches playerFinder/leagueStandings, whose graphs load lib/auth.ts —
    // which throws at import when NEXTAUTH_SECRET is unset. A cron route must not depend on that.
    expect(src).toMatch(/from '@\/lib\/core-app\/rankingsCommunity'/)
    expect(src).not.toMatch(/from '@\/lib\/core-app\/rankings'/)
    const community = readFileSync(path.join(process.cwd(), 'lib/core-app/rankingsCommunity.ts'), 'utf8')
    const imports = [...community.matchAll(/^import (?:type )?[^'";]*? from '([^']+)'/gm)].map((m) => m[1]).sort()
    expect(imports).toEqual([
      '@/lib/core-app/rankingsEngine',
      '@/lib/core-app/rankingsSnapshots',
      '@/lib/prisma',
      '@/lib/rank/careerLedger',
      '@/lib/rank/careerXp',
      '@/lib/rank/levels',
    ])
  })
})
