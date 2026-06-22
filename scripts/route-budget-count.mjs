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
const KEEP = new Set([
  'app/api/cron/waivers/route.ts',
  'app/api/admin/automation/health/route.ts','app/api/admin/automation/waivers/run/route.ts',
  'app/api/ai/waivers/commissioner-insights/route.ts','app/api/ai/waivers/recommend/route.ts',
  // admin keeps (only relevant to the NEW set)
  ...(baseline ? [] : [
    'app/api/admin/sports/sync/route.ts','app/api/admin/fantasy-data/import/route.ts',
  ]),
])

const DISABLE = baseline ? DISABLE_BASE : [...DISABLE_BASE, ...DISABLE_NEW]
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
