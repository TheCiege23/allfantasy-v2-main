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
  // Sports-data ingestion crons, restored to the build by #284. This list is the THIRD
  // hand-maintained copy of the build script's filesToKeep (the others being
  // scripts/vercel-next-build.cjs and scripts/route-budget-count.mjs), and nothing
  // asserts the three agree. Leaving these out made this guard subtract 13 routes that
  // actually ship — under-reporting against GREEN_LIMIT, so the cap check would fire 13
  // routes late in exactly the situation it exists to catch.
  'app/api/cron/import-players/route.ts', 'app/api/cron/import-injuries/route.ts',
  'app/api/cron/import-news/route.ts', 'app/api/cron/import-scores/route.ts',
  'app/api/cron/import-standings/route.ts', 'app/api/cron/import-schedules/route.ts',
  'app/api/cron/import-depth-charts/route.ts', 'app/api/cron/import-projections/route.ts',
  'app/api/cron/adp-refresh/route.ts', 'app/api/cron/recompute-allfantasy-adp/route.ts',
  'app/api/cron/draft-pool-prewarm/route.ts', 'app/api/cron/fantasy-os-exec-sync/route.ts',
  'app/api/cron/trade-weekly-recalibration/route.ts',
  // scheduled in vercel.json — must be kept or they 404 (see vercel-next-build.cjs).
  // Union of this branch's two and main's one; keeping only one side re-breaks the other.
  'app/api/cron/draft-tick/route.ts', 'app/api/cron/live-score-tick/route.ts',
  'app/api/cron/sync-player-images/route.ts',
  'app/api/cron/legacy-import-drain/route.ts',
  'app/api/admin/automation/health/route.ts', 'app/api/admin/automation/waivers/run/route.ts',
  'app/api/ai/waivers/commissioner-insights/route.ts', 'app/api/ai/waivers/recommend/route.ts',
  // Admin routes with live non-admin/lib callers — kept built despite app/api/admin exclusion.
  'app/api/admin/sports/sync/route.ts', 'app/api/admin/fantasy-data/import/route.ts',
  // Fetched by the admin dashboard UI itself (app/admin/** is NOT excluded and does ship, so
  // excluding these made the panel render against 404s).
  'app/api/admin/visitor-analytics/route.ts', 'app/api/admin/api-health/route.ts',
  'app/api/admin/chimmy/health/route.ts', 'app/api/admin/monetization/checkout-link-mapping/route.ts',
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

describe('Every scheduled cron survives the production build', () => {
  // This has now gone wrong three separate times: the original 13 sports-data crons (#284),
  // and two in-flight branches that each added a cron to vercel.json without adding it to
  // filesToKeep. `app/api/cron` is excluded from the build wholesale, so a scheduled-but-not-kept
  // cron is invoked on schedule and 404s every single time — silently, forever. Nothing asserted
  // that vercel.json and the keep-list agreed, so each instance had to be found by hand.
  it('every /api/cron/* path in vercel.json is in FILES_KEPT', () => {
    const vercelJson = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
      crons?: { path: string }[]
    }
    const scheduled = (vercelJson.crons ?? [])
      .map((c) => c.path.split('?')[0]!)
      .filter((p) => p.startsWith('/api/cron/'))

    const kept = new Set(FILES_KEPT)
    // Collect every offender, then assert the list is empty — asserting inside the loop would
    // abort on the first miss and hide the rest.
    const notKept = scheduled.filter((p) => !kept.has(`app${p}/route.ts`))

    expect(notKept).toEqual([])
    expect(scheduled.length).toBeGreaterThan(0) // floor: an empty cron list must not read as a pass
  })

  it('every kept cron route actually exists on disk', () => {
    const missing = FILES_KEPT.filter(
      (f) => f.startsWith('app/api/cron/') && !existsSync(join(root, f))
    )
    expect(missing).toEqual([])
  })
})

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
    for (const rel of suspects) {
      if (!exists(rel)) continue
      const src = read(rel)
      expect(src, `${rel} should not reference /api/ai/context`).not.toContain('/api/ai/context')
    }
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

  function anyCallerOf(urlFragment: string, routePrefix: string): boolean {
    const pattern = new RegExp(`fetch\\([^)]*${urlFragment.replace(/\//g, '\\/')}`)
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
          try { if (pattern.test(readFileSync(child, 'utf8'))) return true } catch {}
        }
      }
    }
    return false
  }

  it('/api/ai/providers is not fetched from production source', () => {
    expect(anyCallerOf('/api/ai/providers', 'app/api/ai/providers/')).toBe(false)
  })

  it('/api/ai/tools is not fetched from production source', () => {
    expect(anyCallerOf('/api/ai/tools', 'app/api/ai/tools/')).toBe(false)
  })

  it('/api/ai/analytics/rollup is not fetched from production source', () => {
    expect(anyCallerOf('/api/ai/analytics/rollup', 'app/api/ai/analytics/')).toBe(false)
  })

  // Route-budget cleanup (2026-06-22): newly build-excluded internal diagnostics.
  it('/api/meta/logs is not fetched from production source', () => {
    expect(anyCallerOf('/api/meta/logs', 'app/api/meta/logs/')).toBe(false)
  })
  it('/api/intelligence/snapshot is not fetched from production source', () => {
    expect(anyCallerOf('/api/intelligence/snapshot', 'app/api/intelligence/snapshot/')).toBe(false)
  })
  it('/api/providers/status is not fetched from production source', () => {
    expect(anyCallerOf('/api/providers/status', 'app/api/providers/status/')).toBe(false)
  })
  it('/api/platform/service-map is not fetched from production source', () => {
    expect(anyCallerOf('/api/platform/service-map', 'app/api/platform/service-map/')).toBe(false)
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
