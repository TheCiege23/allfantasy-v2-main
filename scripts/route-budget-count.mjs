// Route-budget proof: counts PRODUCTION (deployed) route+page functions —
// i.e. files NOT moved out by scripts/vercel-next-build.cjs before `next build`.
// Each deployed function maps to >= 1 Vercel route, so the delta in this number
// is a lower bound on the Vercel route-count reduction.
//
//   node scripts/route-budget-count.mjs            # new (current) disable set
//   node scripts/route-budget-count.mjs --baseline # pre-cleanup disable set
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const baseline = process.argv.includes('--baseline')

function walk(dir) {
  if (!existsSync(dir)) return []
  const r = []
  const st = [dir]
  while (st.length) {
    const c = st.pop()
    for (const e of readdirSync(c, { withFileTypes: true })) {
      const a = join(c, e.name)
      if (e.isDirectory()) st.push(a)
      else if (/\/(route|page)\.(ts|tsx|js|jsx)$/.test(a.replace(/\\/g, '/')))
        r.push(relative(root, a).replace(/\\/g, '/'))
    }
  }
  return r
}

// Disable set as of BEFORE this cleanup PR.
const DISABLE_BASE = [
  'app/e2e','app/tools/social-share-engine-harness','app/tools/public-league-discovery-harness',
  'app/api/cron','app/api/audio-metadata','app/ai-lab','app/lab','app/bracket-review','app/createor',
  'app/api/dev','app/api/e2e','app/api/lab','app/api/simulation-lab','app/march-madness','app/wallet/deposit',
  'app/zombie/[leagueId]','app/zombie/universe','app/survivor/[leagueId]','app/api/zombie','app/api/survivor',
  'app/dev','app/api/internal','app/app/simulation-lab','app/app/zombie-universe',
  'app/api/brackets/world-cup/[challengeId]/admin','app/api/auth/admin-debug','app/api/bracket/workers/health',
  'app/api/ai/analytics/rollup','app/api/marketplace/seed','app/api/ai/providers','app/api/ai/tools',
  'app/big-brother/[bblId]','app/api/big-brother','app/devy/[leagueId]','app/api/devy','app/api/af-debug',
]
// Added by this cleanup PR.
const DISABLE_NEW = [
  'app/admin','app/api/admin',
  'app/api/meta/logs','app/api/intelligence/snapshot','app/api/providers/status','app/api/chaos-detector',
  'app/api/league-health','app/api/league-meta','app/api/platform/service-map',
  'app/api/ai/decision-log','app/api/ai/validation','app/api/ai/memory/quality',
  'app/api/health/fantasycalc','app/api/health/player-valuations','app/api/system/health',
]
// Added by the route-headroom pass (deferred-mode leftover routes, no live caller).
const DISABLE_HEADROOM = [
  'app/api/leagues/[leagueId]/big-brother/ballot','app/api/leagues/[leagueId]/big-brother/cycle',
  'app/api/leagues/[leagueId]/big-brother/finalists','app/api/leagues/[leagueId]/big-brother/have-not',
  'app/api/leagues/[leagueId]/big-brother/hoh','app/api/leagues/[leagueId]/big-brother/hoh-room',
  'app/api/leagues/[leagueId]/big-brother/nominations','app/api/leagues/[leagueId]/big-brother/replacement',
  'app/api/leagues/[leagueId]/big-brother/veto-challenge','app/api/leagues/[leagueId]/big-brother/veto-decision',
  'app/api/leagues/[leagueId]/zombie/attach-universe','app/api/leagues/[leagueId]/zombie/can-trade',
  'app/api/leagues/[leagueId]/zombie/config','app/api/leagues/[leagueId]/zombie/finalize',
  'app/api/leagues/[leagueId]/zombie/horde-sit-outs',
  'app/api/leagues/[leagueId]/devy/admin/automation','app/api/leagues/[leagueId]/devy/admin/force-promote',
  'app/api/leagues/[leagueId]/devy/admin/recalc','app/api/leagues/[leagueId]/devy/admin/regenerate-devy-pool',
  'app/api/leagues/[leagueId]/devy/admin/regenerate-rookie-pool','app/api/leagues/[leagueId]/devy/admin/reopen-window',
  'app/api/leagues/[leagueId]/devy/admin/repair-duplicate-rights','app/api/leagues/[leagueId]/devy/admin/revoke-promotion',
  'app/api/leagues/[leagueId]/devy/audit','app/api/leagues/[leagueId]/devy/outlook',
  'app/api/leagues/[leagueId]/devy/scoring-presets',
]
const KEEP = new Set([
  'app/api/cron/waivers/route.ts',
  // Sports-data ingestion crons, restored to the build 2026-07-19 (see
  // scripts/vercel-next-build.cjs). This KEEP set is a hand-maintained mirror of that
  // script's filesToKeep — they must be updated together or this proof under-reports.
  'app/api/cron/import-players/route.ts',
  'app/api/cron/import-injuries/route.ts',
  'app/api/cron/import-news/route.ts',
  'app/api/cron/import-scores/route.ts',
  'app/api/cron/import-standings/route.ts',
  'app/api/cron/import-schedules/route.ts',
  'app/api/cron/import-depth-charts/route.ts',
  'app/api/cron/import-projections/route.ts',
  'app/api/cron/adp-refresh/route.ts',
  'app/api/cron/recompute-allfantasy-adp/route.ts',
  'app/api/cron/draft-pool-prewarm/route.ts',
  'app/api/cron/fantasy-os-exec-sync/route.ts',
  'app/api/cron/trade-weekly-recalibration/route.ts',
  // scheduled in vercel.json — must be kept or they 404 (see vercel-next-build.cjs).
  // Union of this branch's two and main's one; keeping only one side re-breaks the other.
  'app/api/cron/draft-tick/route.ts',
  'app/api/cron/live-score-tick/route.ts',
  'app/api/cron/sync-player-images/route.ts',
  'app/api/admin/automation/health/route.ts','app/api/admin/automation/waivers/run/route.ts',
  'app/api/ai/waivers/commissioner-insights/route.ts','app/api/ai/waivers/recommend/route.ts',
  // admin keeps (only relevant to the NEW set)
  ...(baseline ? [] : [
    'app/api/admin/sports/sync/route.ts','app/api/admin/fantasy-data/import/route.ts',
  ]),
])

const mainOnly = process.argv.includes('--main') // current main (pre-headroom): BASE + #100
const DISABLE = baseline
  ? DISABLE_BASE
  : mainOnly
    ? [...DISABLE_BASE, ...DISABLE_NEW]
    : [...DISABLE_BASE, ...DISABLE_NEW, ...DISABLE_HEADROOM]
const all = walk(join(root, 'app'))
const disabled = new Set()
for (const d of DISABLE) for (const f of walk(join(root, d))) if (!KEEP.has(f)) disabled.add(f)
const production = all.filter((f) => !disabled.has(f))
let crons = 0
try { crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons?.length || 0 } catch {}

console.log(`mode: ${baseline ? 'BASELINE (pre-cleanup)' : 'CURRENT (post-cleanup)'}`)
console.log(`  total route+page files:       ${all.length}`)
console.log(`  disabled (moved out of build): ${disabled.size}`)
console.log(`  PRODUCTION deployed functions: ${production.length}`)
console.log(`  + vercel crons:                ${crons}`)
console.log(`  = deployed route signals:      ${production.length + crons}`)
