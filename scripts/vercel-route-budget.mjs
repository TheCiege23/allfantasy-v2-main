#!/usr/bin/env node
// Vercel DEPLOYMENT route-budget estimator.
//
// WHY THIS EXISTS
// ---------------
// `scripts/route-budget-count.mjs` counts deployed *function files* and reported
// 1772 while the actual Vercel deployment reported 2049 and failed with:
//
//     errorCode:    too_many_routes
//     errorMessage: Maximum number of routes (rewrites, redirects, etc) exceeded.
//                   Max is 2048, received 2049.
//     errorStep:    process-and-upload-routes
//
// That 277-entry gap made the old number unusable as a gate. This script models
// what Vercel actually counts, and reconciles to 2049 exactly.
//
// THE MODEL (calibrated against the real failing deployment)
// ----------------------------------------------------------
//   App Router route handler  (app/**/route.ts)  -> 1 entry
//   App Router page           (app/**/page.tsx)  -> 2 entries  (the page + its
//                                                   `.rsc` payload variant; see
//                                                   routes-manifest.json .rsc.suffix)
//   next.config.js redirects()                   -> 1 entry each
//   next.config.js headers()                     -> 1 entry each
//   next.config.js rewrites()                    -> 1 entry each
//   framework overhead                           -> ~11 (_next/image, _not-found,
//                                                   favicon/robots/sitemap, error routes)
//   vercel.json crons                            -> 0 entries. Crons INVOKE existing
//                                                   /api/* paths already counted as
//                                                   handlers. The old script added
//                                                   +49 here, double-counting.
//
// Reconciliation of the old number to the real one:
//   1772 (old) + 303 (.rsc) - 49 (bogus crons) + 12 (config) + 11 (overhead) = 2049
//
// NOTE: Pages Router *static* pages (pages/*.tsx) cost ZERO — they are served from
// the filesystem. This was measured directly on PR #308: excluding two such pages
// left the total unchanged at 2049. Only App Router pages carry the .rsc cost.
//
// USAGE
//   node scripts/vercel-route-budget.mjs           # human report
//   node scripts/vercel-route-budget.mjs --json    # machine readable
//   node scripts/vercel-route-budget.mjs --ci      # exit 1 if over FAIL threshold
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()

// ── Thresholds ───────────────────────────────────────────────────────────────
// Vercel's hard platform ceiling. Exceeding this fails the deployment at
// `process-and-upload-routes` AFTER a successful build — so CI that only checks
// "did the build pass" will not catch it.
const CEILING = 2048
const WARN = Number(process.env.ROUTE_BUDGET_WARN ?? 1900)
const FAIL = Number(process.env.ROUTE_BUDGET_FAIL ?? 2020)

const FRAMEWORK_OVERHEAD = 11

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const abs = join(cur, e.name)
      if (e.isDirectory()) stack.push(abs)
      else {
        const rel = relative(root, abs).split(sep).join('/')
        if (/\/(route|page)\.(ts|tsx|js|jsx)$/.test('/' + rel)) out.push(rel)
      }
    }
  }
  return out
}

// The production build shape is defined by the exclusion list that actually
// gates the Vercel build. Import it live rather than duplicating it.
const buildCfg = require(join(root, 'scripts', 'vercel-next-build.cjs'))
const disableDirs = buildCfg.routeDirsToDisable ?? []
const keep = new Set(buildCfg.filesToKeep ?? [])

const all = walk(join(root, 'app'))
const disabled = new Set()
for (const d of disableDirs) {
  for (const f of walk(join(root, d))) if (!keep.has(f)) disabled.add(f)
}
const production = all.filter((f) => !disabled.has(f))
const handlers = production.filter((f) => /\/route\.(ts|tsx|js|jsx)$/.test('/' + f))
const pages = production.filter((f) => /\/page\.(ts|tsx|js|jsx)$/.test('/' + f))

// ── Config-level entries (headers / redirects / rewrites) ────────────────────
// These are the entries the "consolidate your generated headers" advice targets.
// Measured here so the claim can be checked rather than assumed.
//
// Parsed STATICALLY. Do not `require()` next.config.js: it is wrapped in
// withSentryConfig and pulls the whole Next/webpack plugin chain, which hangs
// for minutes. We only need to count `source:` keys inside each block.
function extractBlock(src, header) {
  const start = src.indexOf(header)
  if (start === -1) return null
  const open = src.indexOf('{', start)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return null
}

function countSources(block) {
  if (!block) return 0
  // Strip line comments so commented-out examples are not counted.
  const cleaned = block.replace(/^\s*\/\/.*$/gm, '')
  return (cleaned.match(/(^|[\s{,])source\s*:/g) ?? []).length
}

function loadNextConfigCounts() {
  const res = { redirects: 0, headers: 0, rewrites: 0, source: 'next.config.js' }
  try {
    const src = readFileSync(join(root, 'next.config.js'), 'utf8')
    res.redirects = countSources(extractBlock(src, 'async redirects()'))
    res.headers = countSources(extractBlock(src, 'async headers()'))
    res.rewrites = countSources(extractBlock(src, 'async rewrites()'))
  } catch (err) {
    res.error = String(err?.message ?? err)
  }
  return res
}

function loadVercelJson() {
  try {
    const v = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
    return {
      crons: v.crons?.length ?? 0,
      headers: v.headers?.length ?? 0,
      redirects: v.redirects?.length ?? 0,
      rewrites: v.rewrites?.length ?? 0,
    }
  } catch {
    return { crons: 0, headers: 0, redirects: 0, rewrites: 0 }
  }
}

const nextCfg = loadNextConfigCounts()
const vercelCfg = loadVercelJson()

const configEntries =
  nextCfg.redirects + nextCfg.headers + nextCfg.rewrites +
  vercelCfg.headers + vercelCfg.redirects + vercelCfg.rewrites

const handlerCost = handlers.length
const pageCost = pages.length * 2
const total = handlerCost + pageCost + configEntries + FRAMEWORK_OVERHEAD

const status = total > CEILING ? 'BLOCKED' : total > FAIL ? 'FAIL' : total > WARN ? 'WARN' : 'OK'

// ── Cron integrity guard ─────────────────────────────────────────────────────
// Freeing route budget by adding a directory to `routeDirsToDisable` is the
// standard move here — and it is how PR #284 silently 404'd 13 production crons.
// A cron whose handler was excluded still fires on schedule; it just fails.
// Nothing else in the repo cross-checks vercel.json against the exclusion list.
const cronBroken = []
for (const c of JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).crons ?? []) {
  const urlPath = c.path.split('?')[0].replace(/^\//, '')
  const file = ['ts', 'tsx', 'js'].map((ext) => `app/${urlPath}/route.${ext}`)
    .find((f) => existsSync(join(root, f)))
  if (!file) cronBroken.push({ path: c.path, reason: 'no route file' })
  else if (disabled.has(file)) cronBroken.push({ path: c.path, reason: 'excluded from build', file })
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    total, ceiling: CEILING, warn: WARN, fail: FAIL, status,
    breakdown: {
      routeHandlers: { count: handlers.length, entries: handlerCost, costEach: 1 },
      appPages: { count: pages.length, entries: pageCost, costEach: 2, note: 'page + .rsc variant' },
      config: { entries: configEntries, nextConfig: nextCfg, vercelJson: vercelCfg },
      frameworkOverhead: FRAMEWORK_OVERHEAD,
      cronsCountedAsRoutes: 0,
    },
    excludedFromBuild: disabled.size,
    headroom: CEILING - total,
    cronBroken,
  }, null, 2))
} else {
  const bar = (n) => String(n).padStart(5)
  console.log('')
  console.log('  VERCEL DEPLOYMENT ROUTE BUDGET')
  console.log('  ' + '-'.repeat(58))
  console.log(`  route handlers   ${bar(handlers.length)} x1  = ${bar(handlerCost)}`)
  console.log(`  app pages        ${bar(pages.length)} x2  = ${bar(pageCost)}   (page + .rsc)`)
  console.log(`  config entries               = ${bar(configEntries)}   (redirects ${nextCfg.redirects}, headers ${nextCfg.headers}, rewrites ${nextCfg.rewrites})`)
  console.log(`  framework overhead           = ${bar(FRAMEWORK_OVERHEAD)}`)
  console.log(`  vercel crons                 = ${bar(0)}   (${vercelCfg.crons} crons invoke existing /api paths)`)
  console.log('  ' + '-'.repeat(58))
  console.log(`  TOTAL                        = ${bar(total)}`)
  console.log('')
  console.log(`  excluded from build: ${disabled.size} files (scripts/vercel-next-build.cjs)`)
  console.log(`  Vercel ceiling:      ${CEILING}    headroom: ${CEILING - total}`)
  console.log(`  warn ${WARN} / fail ${FAIL}`)
  console.log('')
  console.log(`  STATUS: ${status}`)
  if (nextCfg.error) console.log(`  ! next.config.js not fully readable: ${nextCfg.error}`)
  console.log('')
  if (cronBroken.length) {
    console.log(`  !! ${cronBroken.length} CRON(S) POINT AT ROUTES THAT ARE NOT DEPLOYED`)
    console.log('     These fire on schedule and 404 (the PR #284 failure mode).')
    for (const c of cronBroken) console.log(`       ${c.path}  (${c.reason})`)
    console.log('     Fix: remove from vercel.json, or add the handler to filesToKeep.')
    console.log('')
  }
}

if (process.argv.includes('--ci')) {
  if (status === 'FAIL' || status === 'BLOCKED') {
    console.error(`route budget ${status}: ${total} entries (fail threshold ${FAIL}, ceiling ${CEILING})`)
    process.exit(1)
  }
  // Opt-in: 10 crons are already broken on main (survivor/zombie/big-brother/devy),
  // so this is not wired into the default gate yet — it would fail CI on a
  // pre-existing bug rather than on the change under review. Turn it on once
  // those are reconciled.
  if (process.argv.includes('--strict-crons') && cronBroken.length) {
    console.error(`${cronBroken.length} cron(s) point at routes that are not deployed`)
    process.exit(1)
  }
}
