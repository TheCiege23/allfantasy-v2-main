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
  it('🛑 cannot be skipped by another writer\'s empty result', () => {
    // The per-league walk and its `if (leagues.length === 0) return counts` are retired (2026-11-17);
    // nothing in the run may return early ahead of a writer.
    const snapAt = src.indexOf('counts.snapshot = await runRankingsDailySnapshot()')
    expect(snapAt).toBeGreaterThan(0)
    expect(src).not.toMatch(/^\s*if \([^)]*\) return counts\s*$/m)
    expect(src.slice(snapAt, snapAt + 300)).toMatch(/\.catch\(\(e: unknown\) => \{\s*const out = emptyRankingsSnapshotCounts\(\)\s*out\.failed = 1/)
    expect(src).toMatch(/snapshot: emptyRankingsSnapshotCounts\(\),/)
  })

  it('🛑 its writes, errors and failures reach the run telemetry', () => {
    // Whitespace-tolerant since the sixth writer (portfolio totals) reflowed these sums across lines.
    expect(src).toMatch(/\+ r\.odds\.written \+ r\.snapshot\.written\b/)
    expect(src).toMatch(/\.\.\.r\.odds\.errors,\s*\.\.\.r\.snapshot\.errors,/)
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
      '@/lib/rank/calculateRank',
      '@/lib/rank/careerLedger',
      '@/lib/rank/careerXp',
      '@/lib/rank/levels',
    ])
  })

  it('🛑 the level refresh it added (calculateRank) keeps the graph lean one hop further', () => {
    // calculateRank is the 2026-10-01 addition: the daily snapshot rewrites stale stored levels.
    // Its career-profile hook must stay a DYNAMIC import — a static one would pull the profile
    // module's graph into this cron at load time.
    const staticImports = (file: string) =>
      [...readFileSync(path.join(process.cwd(), file), 'utf8').matchAll(/^import (?:type )?[^'";]*? from '([^']+)'/gm)]
        .map((m) => m[1])
        .sort()
    expect(staticImports('lib/rank/calculateRank.ts')).toEqual([
      '@/lib/core-app/careerProfileRefresh',
      '@/lib/prisma',
      '@/lib/rank/careerLedger',
      '@/lib/rank/careerXp',
      '@/lib/rank/levels',
    ])
    expect(staticImports('lib/core-app/careerProfileRefresh.ts')).toEqual([])
  })

  it('🛑 the retired per-league draft/waiver warm stays retired: nothing read those entries', () => {
    expect(src).not.toMatch(/from '@\/lib\/decision-os\/draft-os'/)
    expect(src).not.toMatch(/from '@\/lib\/decision-os\/waiver-os'/)
    // Anchored to code, not prose: the header names both sources to explain the retirement.
    expect(src).not.toMatch(/^[^*/\n]*\b(?:draftRulesSource|waiverSettingsSource)\b/m)
  })
})
