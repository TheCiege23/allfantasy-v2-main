import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import vercelBuildConfig from '../scripts/vercel-next-build.cjs'

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

// Imported (not hand-duplicated) from scripts/vercel-next-build.cjs — the file
// that actually gates the production build. This list drifting out of sync with
// the real build config (independently, in up to 4 places at once) is exactly
// how the /api/admin/{visitor-analytics,api-health,chimmy/health,monetization/
// checkout-link-mapping} 404 regression (#312) and the /api/ai/analytics/rollup
// staleness both shipped unnoticed. Do not hand-copy entries here again.
const EXCLUDED_DIRS = vercelBuildConfig.routeDirsToDisable
const FILES_KEPT = vercelBuildConfig.filesToKeep

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
  // NOTE: components/admin/ was removed from this list deliberately (2026-07-21).
  // app/admin/** (the admin UI) is NOT build-excluded — only app/api/admin/** is,
  // and only partially (see filesToKeep in vercel-next-build.cjs) — so its
  // components DO run in production and must be scanned as real callers. Excluding
  // components/admin/ here previously hid a real bug: ChimmyKPIReadout.tsx (under
  // components/admin/) fetches /api/ai/analytics/rollup, which was excluded from
  // the build — a 404 that this exact test category exists to catch, but couldn't,
  // because its caller lived in a prefix this list told the scanner to skip.
  const EXCLUDED_SOURCE_PREFIXES = [
    'app/api/admin/',
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

  // /api/ai/analytics/rollup is deliberately NOT asserted here (2026-07-21).
  // This test category exists to catch a production caller of a build-excluded
  // route — but this specific route was moved into filesToKeep (see
  // scripts/vercel-next-build.cjs) precisely so ChimmyKPIReadout.tsx's existing
  // call stops 404ing, rather than removing the call. "Has a production caller"
  // is now the intended state, not a regression. The invariant that actually
  // matters going forward — this route must stay in filesToKeep as long as
  // anything calls it — is covered by the "Admin endpoint contract" describe
  // block below, which asserts on the (caller, route) pair directly instead of
  // assuming callers shouldn't exist.

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

// ── Admin endpoint contract — every referenced /api/admin|/api/ai route must ──
// ── actually exist AND actually ship to production ────────────────────────────
//
// This is the drift-protection guard requested after the #312 regression: a UI
// fetching a URL is not proof the URL works. Scans the same surfaces the manual
// audit did (app/admin, components/admin) for literal /api/admin/* and /api/ai/*
// references — whether inside fetch() or an href — and fails if the referenced
// route either (a) has no route.ts on disk, or (b) exists but is excluded from
// the production build and not in filesToKeep. Both failure modes render as
// zeros/empty cards or dead links in prod without ever failing a build.

describe('Admin endpoint contract — referenced routes exist and ship', () => {
  const CONTRACT_SCAN_DIRS = ['app/admin', 'components/admin']
  const URL_PATTERN = /\/api\/(?:admin|ai)\/[A-Za-z0-9\-_/]*/g

  // Known pre-existing gaps on main (2026-07-21): these components already
  // referenced a route with no backing file before this PR touched anything —
  // confirmed via `git show origin/main:<file>`, unmodified by this PR. Fixing
  // the underlying components (build the missing route? rewire to the right
  // one? remove the card?) is a separate, unrelated decision outside this PR's
  // scope (admin/operator console cutover). Listed explicitly — not silently
  // excluded — so removing an entry without actually fixing the route fails
  // immediately via the loop below.
  const KNOWN_PREEXISTING_GAPS = new Set([
    '/api/admin/simulate-league', // components/admin/SimulateLeagueButton.tsx
    '/api/admin/usage', // components/admin/UsageAnalyticsPanel.tsx
    '/api/admin/usage/summary', // components/admin/UsageAnalyticsPanel.tsx
    '/api/admin/ai/metrics', // components/admin/ai/AdminAIOutcomeDashboard.tsx — real endpoint is /api/admin/metrics
    '/api/admin/ai/recommendations', // components/admin/ai/AIRecommendationTable.tsx
  ])

  // Strips text that can contain a /api/admin or /api/ai path fragment but is
  // never actually requested at runtime: comments (JSDoc referencing the route
  // file for its response shape) and type-only imports (importing a route
  // file's exported type, not calling it). Without this, the scan below treats
  // e.g. `// matching app/api/admin/x/route.ts` or
  // `import type {...} from "@/app/api/admin/x/route"` as if they were a real
  // reference to the URL `/api/admin/x/route` — a URL that never existed.
  function stripNonRuntimeText(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/import\s+type\s*\{[^}]*\}\s*from\s*["'][^"']*["']\s*;?/g, '')
  }

  function walkSourceFiles(dir: string): string[] {
    const abs = join(root, dir)
    if (!existsSync(abs)) return []
    const result: string[] = []
    const stack = [abs]
    while (stack.length) {
      const cur = stack.pop()!
      for (const entry of readdirSync(cur, { withFileTypes: true })) {
        const child = join(cur, entry.name)
        if (entry.isDirectory()) { stack.push(child); continue }
        if (/\.(ts|tsx)$/.test(entry.name)) result.push(child)
      }
    }
    return result
  }

  function findReferencedUrls(): { url: string; file: string }[] {
    const found: { url: string; file: string }[] = []
    for (const dir of CONTRACT_SCAN_DIRS) {
      for (const abs of walkSourceFiles(dir)) {
        const rel = relative(root, abs).replace(/\\/g, '/')
        const src = stripNonRuntimeText(readFileSync(abs, 'utf8'))
        const matches = src.match(URL_PATTERN)
        if (!matches) continue
        for (const raw of matches) {
          const url = raw.replace(/\/$/, '') // drop a trailing slash before an interpolation/param
          found.push({ url, file: rel })
        }
      }
    }
    return found
  }

  function routeFileFor(url: string): string {
    return `app${url}/route.ts`
  }

  function isExcludedFromBuild(routeFile: string): boolean {
    const isUnderDisabledDir = (EXCLUDED_DIRS as string[]).some(
      (d) => routeFile === d || routeFile.startsWith(`${d}/`)
    )
    if (!isUnderDisabledDir) return false
    return !(FILES_KEPT as string[]).includes(routeFile)
  }

  const referenced = findReferencedUrls()
  const uniqueByUrl = new Map<string, string>() // url -> first file that referenced it
  for (const { url, file } of referenced) {
    if (!uniqueByUrl.has(url)) uniqueByUrl.set(url, file)
  }

  it('scanned at least one /api/admin or /api/ai reference (guard against a broken walk)', () => {
    expect(referenced.length, 'found zero references — app/admin or components/admin may have moved').toBeGreaterThan(0)
  })

  for (const [url, file] of uniqueByUrl) {
    const routeFile = routeFileFor(url)
    if (KNOWN_PREEXISTING_GAPS.has(url)) {
      it.todo(`${url} (referenced from ${file}) — pre-existing gap, route file missing, tracked separately from this PR`)
      continue
    }
    it(`${url} (referenced from ${file}) resolves to a route file that exists on disk`, () => {
      expect(exists(routeFile), `${file} references ${url}, but ${routeFile} does not exist`).toBe(true)
    })
    it(`${url} is not excluded from the production build`, () => {
      expect(
        isExcludedFromBuild(routeFile),
        `${file} references ${url} (${routeFile}), but it is excluded from the production build and not in filesToKeep — this 404s in prod exactly like #312`
      ).toBe(false)
    })
  }

  // Regression guard for a specifically-reported drift: the admin UI fetching
  // /api/admin/ai/metrics when only /api/admin/metrics exists. Not a vacuous
  // string-literal check — it reads the real scan result above, so it fails the
  // moment anything under app/admin or components/admin references the wrong
  // path again, and stays silent while nothing does.
  it('does not regress the /api/admin/ai/metrics vs /api/admin/metrics naming drift', () => {
    const regressed = referenced.find((c) => c.url === '/api/admin/ai/metrics')
    // Already broken on main today (see KNOWN_PREEXISTING_GAPS) — dormant while
    // listed there. Fires the moment it's removed from that list without the
    // route actually existing, so this guard can't be silently defeated.
    if (regressed && !KNOWN_PREEXISTING_GAPS.has('/api/admin/ai/metrics')) {
      expect(
        exists('app/api/admin/ai/metrics/route.ts'),
        `${regressed.file} fetches /api/admin/ai/metrics, which has no route file — the real endpoint is /api/admin/metrics`
      ).toBe(true)
    }
  })
})
