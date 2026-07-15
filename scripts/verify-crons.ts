/**
 * verify-crons — assert every vercel.json cron has a real handler (and no dup paths).
 *
 * For each `crons[].path` in vercel.json this:
 *   1. strips the query string (Vercel invokes the same App-Router file regardless of
 *      `?job=…` etc., so the 5 world-cup `sync?job=…` entries share one handler), and
 *   2. asserts a matching `app/<path>/route.{ts,tsx,js,mjs}` exists — a missing one would
 *      404 when Vercel fires it.
 * It also flags any FULL path (path incl. query string) listed more than once — a real
 * duplicate Vercel can't distinguish (e.g. the historical `/api/zombie/automation` x2),
 * as opposed to the world-cup entries which are distinct by `?job=`.
 *
 * Pure Node built-ins only (fs/path) so it runs anywhere via `tsx scripts/verify-crons.ts`
 * and imports cleanly into a vitest test. All cron paths today are static (no `[param]`
 * segments); if a dynamic-segment cron is ever added this concrete-path check must grow.
 *
 * CLI: `npm run verify:crons` (exit 1 on any dangling or duplicate).
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type CronEntry = { path?: string; schedule?: string }

export type DanglingEntry = { path: string; expectedFile: string }
export type DuplicateEntry = { path: string; count: number }

export type CronCheckResult = {
  ok: boolean
  totalEntries: number
  uniqueHandlers: number
  dangling: DanglingEntry[]
  duplicatePaths: DuplicateEntry[]
  resolved: Array<{ path: string; file: string }>
}

const ROUTE_CANDIDATES = ['route.ts', 'route.tsx', 'route.js', 'route.mjs'] as const

/** Vercel cron `path` → the expected App-Router handler file (query string dropped). */
export function cronPathToRouteFile(cronPath: string): string {
  const base = cronPath.split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '')
  return `app/${base}/route.ts`
}

function resolveHandler(repoRoot: string, cronPath: string): string | null {
  const base = cronPath.split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '')
  for (const candidate of ROUTE_CANDIDATES) {
    const rel = `app/${base}/${candidate}`
    if (existsSync(resolve(repoRoot, rel))) return rel
  }
  return null
}

/** Core check over an in-memory crons array (used by both the CLI and the test). */
export function checkCronPaths(crons: CronEntry[], repoRoot: string): CronCheckResult {
  const dangling: DanglingEntry[] = []
  const resolved: CronCheckResult['resolved'] = []
  const seenHandler = new Set<string>()
  const fullPathCounts = new Map<string, number>()

  for (const cron of crons) {
    const path = typeof cron?.path === 'string' ? cron.path.trim() : ''
    if (!path) continue

    // Duplicate detection keys on the FULL path (incl. query) so world-cup `?job=` variants
    // stay distinct while an identical repeated path is flagged.
    fullPathCounts.set(path, (fullPathCounts.get(path) ?? 0) + 1)

    // Handler existence is per query-stripped file; check each handler once.
    const expectedFile = cronPathToRouteFile(path)
    if (seenHandler.has(expectedFile)) continue
    seenHandler.add(expectedFile)

    const found = resolveHandler(repoRoot, path)
    if (found) resolved.push({ path, file: found })
    else dangling.push({ path, expectedFile })
  }

  const duplicatePaths: DuplicateEntry[] = [...fullPathCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([path, count]) => ({ path, count }))

  return {
    ok: dangling.length === 0 && duplicatePaths.length === 0,
    totalEntries: crons.filter((c) => typeof c?.path === 'string' && c.path.trim()).length,
    uniqueHandlers: seenHandler.size,
    dangling,
    duplicatePaths,
    resolved,
  }
}

/** Read vercel.json from `repoRoot` and run the check. */
export function verifyCrons(repoRoot: string, vercelJsonPath = 'vercel.json'): CronCheckResult {
  const raw = readFileSync(resolve(repoRoot, vercelJsonPath), 'utf8')
  const parsed = JSON.parse(raw) as { crons?: CronEntry[] }
  const crons = Array.isArray(parsed.crons) ? parsed.crons : []
  return checkCronPaths(crons, repoRoot)
}

export function formatReport(result: CronCheckResult): string {
  const lines: string[] = []
  lines.push(
    `verify-crons: ${result.totalEntries} cron entries, ${result.uniqueHandlers} unique handlers.`,
  )
  if (result.dangling.length > 0) {
    lines.push(`\n✗ ${result.dangling.length} cron path(s) with NO handler (would 404):`)
    for (const d of result.dangling) lines.push(`   ${d.path}  →  missing ${d.expectedFile}`)
  }
  if (result.duplicatePaths.length > 0) {
    lines.push(`\n✗ ${result.duplicatePaths.length} duplicate cron path(s) (Vercel can't distinguish):`)
    for (const d of result.duplicatePaths) lines.push(`   ${d.path}  (listed ${d.count}x)`)
  }
  lines.push(result.ok ? '\n✓ All cron paths resolve to a real handler; no duplicates.' : '\n✗ verify-crons FAILED.')
  return lines.join('\n')
}

// CLI entry (CommonJS repo — tsx runs this as CJS, so require.main works; the typeof guards
// keep it inert when imported by the test runner, and scripts/ is excluded from tsc).
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const result = verifyCrons(process.cwd())
  // eslint-disable-next-line no-console
  console.log(formatReport(result))
  if (!result.ok) process.exitCode = 1
}
