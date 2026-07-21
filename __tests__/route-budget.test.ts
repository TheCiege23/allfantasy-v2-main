import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}
function exists(rel: string): boolean {
  return existsSync(resolve(root, rel))
}

// ── Budget helpers ────────────────────────────────────────────────────────────

function walkRouteFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const result: string[] = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const abs = join(cur, entry.name)
      if (entry.isDirectory()) {
        stack.push(abs)
      } else if (/\/(route|page)\.(ts|tsx|js|jsx)$/.test(abs.replace(/\\/g, '/'))) {
        result.push(relative(root, abs).replace(/\\/g, '/'))
      }
    }
  }
  return result
}

const EXCLUDED_DIRS = [
  'app/e2e', 'app/tools/social-share-engine-harness', 'app/tools/public-league-discovery-harness',
  'app/admin', 'app/api/admin', 'app/api/cron', 'app/api/audio-metadata',
  'app/ai-lab', 'app/lab', 'app/bracket-review', 'app/createor',
  'app/api/dev', 'app/api/e2e', 'app/api/lab', 'app/api/simulation-lab',
  'app/march-madness', 'app/wallet/deposit',
  'app/zombie/[leagueId]', 'app/zombie/universe',
  'app/survivor/[leagueId]', 'app/api/zombie', 'app/api/survivor',
  'app/dev', 'app/api/internal', 'app/app/simulation-lab', 'app/app/zombie-universe',
  'app/api/brackets/world-cup/[challengeId]/admin',
  'app/api/auth/admin-debug', 'app/api/bracket/workers/health',
  'app/api/ai/analytics/rollup', 'app/api/marketplace/seed',
  'app/api/ai/providers', 'app/api/ai/tools',
  // Route-budget cleanup (2026-06-22): internal diagnostics/metrics/meta with no
  // production caller. Mirrors scripts/vercel-next-build.cjs routeDirsToDisable.
  // (league-health removed 2026-07-06 — Dashboard Sprint 2's MyLeagueCard is now a
  // real production caller; it must stay built. See vercel-next-build.cjs.)
  'app/api/meta/logs', 'app/api/intelligence/snapshot', 'app/api/providers/status',
  'app/api/chaos-detector', 'app/api/league-meta',
  'app/api/platform/service-map', 'app/api/ai/decision-log', 'app/api/ai/validation',
  'app/api/ai/memory/quality',
  'app/api/health/fantasycalc', 'app/api/health/player-valuations', 'app/api/system/health',
  // Route-headroom pass (2026-06-22): deferred-mode (big-brother/zombie/devy) leftover
  // gameplay/admin routes with no live caller. Mirrors scripts/vercel-next-build.cjs.
  'app/api/leagues/[leagueId]/big-brother/ballot', 'app/api/leagues/[leagueId]/big-brother/cycle',
  'app/api/leagues/[leagueId]/big-brother/finalists', 'app/api/leagues/[leagueId]/big-brother/have-not',
  'app/api/leagues/[leagueId]/big-brother/hoh', 'app/api/leagues/[leagueId]/big-brother/hoh-room',
  'app/api/leagues/[leagueId]/big-brother/nominations', 'app/api/leagues/[leagueId]/big-brother/replacement',
  'app/api/leagues/[leagueId]/big-brother/veto-challenge', 'app/api/leagues/[leagueId]/big-brother/veto-decision',
  'app/api/leagues/[leagueId]/zombie/attach-universe', 'app/api/leagues/[leagueId]/zombie/can-trade',
  'app/api/leagues/[leagueId]/zombie/config', 'app/api/leagues/[leagueId]/zombie/finalize',
  'app/api/leagues/[leagueId]/zombie/horde-sit-outs',
  'app/api/leagues/[leagueId]/devy/admin/automation', 'app/api/leagues/[leagueId]/devy/admin/force-promote',
  'app/api/leagues/[leagueId]/devy/admin/recalc', 'app/api/leagues/[leagueId]/devy/admin/regenerate-devy-pool',
  'app/api/leagues/[leagueId]/devy/admin/regenerate-rookie-pool', 'app/api/leagues/[leagueId]/devy/admin/reopen-window',
  'app/api/leagues/[leagueId]/devy/admin/repair-duplicate-rights', 'app/api/leagues/[leagueId]/devy/admin/revoke-promotion',
  'app/api/leagues/[leagueId]/devy/audit', 'app/api/leagues/[leagueId]/devy/outlook',
  'app/api/leagues/[leagueId]/devy/scoring-presets',
]

const FILES_KEPT = [
  'app/api/cron/_auth.ts', 'app/api/cron/waivers/route.ts',
  'app/api/admin/automation/health/route.ts', 'app/api/admin/automation/waivers/run/route.ts',
  'app/api/ai/waivers/commissioner-insights/route.ts', 'app/api/ai/waivers/recommend/route.ts',
  // Admin routes with live non-admin/lib callers — kept built despite app/api/admin exclusion.
  'app/api/admin/sports/sync/route.ts', 'app/api/admin/fantasy-data/import/route.ts',
]

function getProductionSignals(): number {
  const appDir = join(root, 'app')
  if (!existsSync(appDir)) return 0
  const SKIP = new Set(['node_modules', '.next'])
  const stack = [appDir]
  let sourceTotal = 0
  while (stack.length) {
    const cur = stack.pop()!
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const abs = join(cur, entry.name)
      const rel = relative(root, abs).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith('.next-build')) stack.push(abs)
        continue
      }
      if (/\/(route|page)\.(ts|tsx|js|jsx)$/.test(rel)) sourceTotal++
    }
  }
  let excludedTotal = 0
  for (const relDir of EXCLUDED_DIRS) {
    const abs = join(root, relDir)
    if (!existsSync(abs)) continue
    const s = statSync(abs)
    if (s.isDirectory()) excludedTotal += walkRouteFiles(abs).length
    else if (/\/(route|page)\.(ts|tsx|js|jsx)$/.test(relDir)) excludedTotal += 1
  }
  const keptInExcluded = FILES_KEPT.filter((f) =>
    EXCLUDED_DIRS.some((e) => f.startsWith(e + '/') || f === e)
  ).length
  const netExcluded = excludedTotal - keptInExcluded
  let crons = 0
  try { crons = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).crons?.length ?? 0 } catch {}
  return (sourceTotal - netExcluded) + crons
}

describe('Route budget — deleted routes must stay gone', () => {
  it('app/api/ai/context/route.ts is removed from disk', () => {
    expect(exists('app/api/ai/context/route.ts')).toBe(false)
  })

  it('no active fetch of /api/ai/context in app/', () => {
    // Guard: if someone re-adds a caller without re-adding the route they'll get a 404.
    // This test catches that drift at CI time.
    const suspects = [
      'app/dashboard/page.tsx',
      'app/dashboard/DashboardShell.tsx',
    ]
    // Skipping a missing suspect used to be the whole loop body's escape hatch, so if
    // both were ever renamed this asserted nothing and still passed. Track what was
    // actually inspected and require it to be non-empty.
    const inspected: string[] = []
    const offenders: string[] = []
    for (const rel of suspects) {
      if (!exists(rel)) continue
      inspected.push(rel)
      if (read(rel).includes('/api/ai/context')) offenders.push(rel)
    }
    expect(inspected.length, `none of the suspect files exist any more (${suspects.join(', ')}) — this guard is checking nothing; re-point it`)
      .toBeGreaterThan(0)
    expect(offenders, `these still reference the deleted /api/ai/context route: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('Admin AI monitor — gating and wiring', () => {
  const dashPage = read('app/dashboard/page.tsx')

  it('does not render admin monitors on the customer dashboard', () => {
    expect(dashPage).not.toContain("from '@/lib/adminAuth'")
    expect(dashPage).not.toContain("from '@/lib/ai/aiUsageMonitor'")
    expect(dashPage).not.toContain("from '@/components/admin/AiUsageMonitorPanel'")
    expect(dashPage).not.toContain('AI Ops Monitor')
    expect(dashPage).not.toContain('adminReport')
  })
})

// ── Deleted dead routes must stay deleted ─────────────────────────────────────

describe('Route budget — dead routes deleted in cleanup must stay gone', () => {
  const DELETED = [
    'app/api/ai/orchestrate/route.ts',
    'app/api/ai/intelligence/context/route.ts',
    'app/api/ai/memory/quality/feedback/route.ts',
    'app/api/ai/ai-gm-analyze/route.ts',
    'app/api/ai/generate-image/route.ts',
  ]
  for (const route of DELETED) {
    it(`${route} does not exist`, () => {
      expect(exists(route), `${route} was re-created — delete it to stay under budget`).toBe(false)
    })
  }
})

// ── Excluded routes have no active production fetch callers ───────────────────

describe('Route budget — build-excluded routes have no active production fetch callers', () => {
  const SOURCE_DIRS = ['app', 'components', 'lib']

  // Prefixes excluded from production build — callers here never run in prod.
  const EXCLUDED_SOURCE_PREFIXES = [
    'app/admin/',
    'app/api/admin/',
    'components/admin/',
  ]

  /**
   * Minimum production source files this scan must see before its verdict means
   * anything. `app/` + `components/` + `lib/` are thousands of files; if a walk ever
   * returns a handful, it broke rather than found a clean tree.
   */
  const MIN_SCANNED = 500

  /*
   * Returns whether any production source fetches `urlFragment`, and how many files
   * it actually read to decide that.
   *
   * The count is not decoration. This helper previously returned a bare `false` —
   * "no caller found", i.e. PASS — whenever the walk came up empty, so a renamed
   * source dir or an unreadable file made all seven tests below pass while scanning
   * nothing. A guard against shipping a caller to a build-excluded route must fail
   * closed, so callers assert on `scanned` too. Read errors are surfaced for the same
   * reason rather than swallowed: an unreadable file is an unchecked file.
   */
  function anyCallerOf(urlFragment: string, routePrefix: string): { found: boolean; scanned: number; unreadable: string[] } {
    const pattern = new RegExp(`fetch\\([^)]*${urlFragment.replace(/\//g, '\\/')}`)
    let scanned = 0
    const unreadable: string[] = []
    for (const dir of SOURCE_DIRS) {
      const abs = join(root, dir)
      if (!existsSync(abs)) continue
      const stack = [abs]
      while (stack.length) {
        const cur = stack.pop()!
        for (const entry of readdirSync(cur, { withFileTypes: true })) {
          const child = join(cur, entry.name)
          const rel = relative(root, child).replace(/\\/g, '/')
          if (entry.isDirectory()) { stack.push(child); continue }
          if (!/\.(ts|tsx)$/.test(entry.name)) continue
          // Skip the route file itself and any excluded-from-production source.
          if (rel.startsWith(routePrefix)) continue
          if (EXCLUDED_SOURCE_PREFIXES.some((p) => rel.startsWith(p))) continue
          let src: string
          try { src = readFileSync(child, 'utf8') } catch { unreadable.push(rel); continue }
          scanned += 1
          if (pattern.test(src)) return { found: true, scanned, unreadable }
        }
      }
    }
    return { found: false, scanned, unreadable }
  }

  /** Asserts the verdict AND that the scan was real enough to have produced one. */
  function expectNoProductionCaller(urlFragment: string, routePrefix: string) {
    const { found, scanned, unreadable } = anyCallerOf(urlFragment, routePrefix)
    expect(unreadable, `unreadable source files — these went unchecked: ${unreadable.join(', ')}`).toEqual([])
    expect(scanned, `only scanned ${scanned} files (<${MIN_SCANNED}) — the walk is broken, so a clean result proves nothing`)
      .toBeGreaterThan(MIN_SCANNED)
    expect(found, `${urlFragment} is fetched from production source but its route is excluded from the production build — that call 404s in prod`).toBe(false)
  }

  it('/api/ai/providers is not fetched from production source', () => {
    expectNoProductionCaller('/api/ai/providers', 'app/api/ai/providers/')
  })

  it('/api/ai/tools is not fetched from production source', () => {
    expectNoProductionCaller('/api/ai/tools', 'app/api/ai/tools/')
  })

  it('/api/ai/analytics/rollup is not fetched from production source', () => {
    expectNoProductionCaller('/api/ai/analytics/rollup', 'app/api/ai/analytics/')
  })

  // Route-budget cleanup (2026-06-22): newly build-excluded internal diagnostics.
  it('/api/meta/logs is not fetched from production source', () => {
    expectNoProductionCaller('/api/meta/logs', 'app/api/meta/logs/')
  })
  it('/api/intelligence/snapshot is not fetched from production source', () => {
    expectNoProductionCaller('/api/intelligence/snapshot', 'app/api/intelligence/snapshot/')
  })
  it('/api/providers/status is not fetched from production source', () => {
    expectNoProductionCaller('/api/providers/status', 'app/api/providers/status/')
  })
  it('/api/platform/service-map is not fetched from production source', () => {
    expectNoProductionCaller('/api/platform/service-map', 'app/api/platform/service-map/')
  })
})

// ── Production-adjusted route budget must stay GREEN ─────────────────────────

describe('Route budget — production-adjusted signals must stay GREEN', () => {
  const GREEN_LIMIT = 1900
  const YELLOW_LIMIT = 2020

  it(`production-adjusted signals are below GREEN limit (${GREEN_LIMIT})`, () => {
    const signals = getProductionSignals()
    expect(signals, `Signals hit ${signals} ≥ ${GREEN_LIMIT}. Delete or exclude routes before adding new ones.`)
      .toBeLessThan(GREEN_LIMIT)
  })

  it(`production-adjusted signals are below YELLOW limit (${YELLOW_LIMIT})`, () => {
    const signals = getProductionSignals()
    expect(signals, `Signals in yellow zone (${signals}). Urgent: exclude or delete before next deploy.`)
      .toBeLessThan(YELLOW_LIMIT)
  })
})

// ── World Cup chat consolidation stays consolidated ───────────────────────────

describe('Route budget — World Cup chat stays consolidated', () => {
  const CONSOLIDATED = 'app/api/brackets/world-cup/[challengeId]/chat/route.ts'
  const OLD_FEATURE_ROUTES = [
    'app/api/brackets/world-cup/[challengeId]/chat/gifs/route.ts',
    'app/api/brackets/world-cup/[challengeId]/chat/upload-image/route.ts',
    'app/api/brackets/world-cup/[challengeId]/notification-preferences/route.ts',
    'app/api/brackets/world-cup/[challengeId]/chat/[messageId]/poll-vote/route.ts',
  ]

  it('consolidated chat route exists', () => {
    expect(exists(CONSOLIDATED)).toBe(true)
  })

  for (const route of OLD_FEATURE_ROUTES) {
    it(`old feature route is absent: ${route}`, () => {
      expect(exists(route), `${route} was re-created — use ?action= dispatch instead`).toBe(false)
    })
  }
})
