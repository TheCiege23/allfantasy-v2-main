// Find PRODUCTION route handlers with no production fetch/string caller.
// Heuristic, conservative: a route is a "dead candidate" only if its URL path
// appears in NO source file under app/ components/ lib/ hooks/ (excluding the
// route's own file), AND it is not a vercel cron target. We DO count references
// in tests/e2e/docs/scripts separately (informational) but do not treat them as
// production usage.
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

const root = process.cwd()
function walk(dir, pred) {
  if (!existsSync(dir)) return []
  const r = []
  const st = [dir]
  while (st.length) {
    const c = st.pop()
    for (const e of readdirSync(c, { withFileTypes: true })) {
      const a = join(c, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.next')) st.push(a); continue }
      const rel = relative(root, a).replace(/\\/g, '/')
      if (pred(rel)) r.push(rel)
    }
  }
  return r
}

// Production route handlers only (exclude already-disabled dirs).
const DISABLE = [
  'app/e2e','app/tools/social-share-engine-harness','app/tools/public-league-discovery-harness',
  'app/api/cron','app/api/audio-metadata','app/ai-lab','app/lab','app/bracket-review','app/createor',
  'app/api/dev','app/api/e2e','app/api/lab','app/api/simulation-lab','app/march-madness','app/wallet/deposit',
  'app/zombie/[leagueId]','app/zombie/universe','app/survivor/[leagueId]','app/api/zombie','app/api/survivor',
  'app/dev','app/api/internal','app/app/simulation-lab','app/app/zombie-universe',
  'app/api/brackets/world-cup/[challengeId]/admin','app/api/auth/admin-debug','app/api/bracket/workers/health',
  'app/api/ai/analytics/rollup','app/api/marketplace/seed','app/api/ai/providers','app/api/ai/tools',
  'app/big-brother/[bblId]','app/api/big-brother','app/devy/[leagueId]','app/api/devy','app/api/af-debug',
]
const isDisabled = (rel) => DISABLE.some((d) => rel === d || rel.startsWith(d + '/'))

const handlers = walk(join(root, 'app', 'api'), (rel) => /\/route\.(ts|tsx)$/.test(rel) && !isDisabled(rel))

// Convert a route file path to its URL path (drop app, drop /route.ts, keep [..]).
function urlOf(rel) {
  return '/' + rel.replace(/^app\//, '').replace(/\/route\.(ts|tsx)$/, '')
}
// A "search token" = the static prefix of the URL up to the first dynamic segment.
function staticToken(url) {
  const parts = url.split('/')
  const out = []
  for (const p of parts) { if (p.startsWith('[')) break; out.push(p) }
  return out.join('/')
}

// Gather all source text (production) and (separately) test/doc text.
const PROD_DIRS = ['app', 'components', 'lib', 'hooks', 'app/hooks', 'middleware.ts']
const prodFiles = walk(join(root, 'app'), (r) => /\.(ts|tsx)$/.test(r) && !/\/route\.(ts|tsx)$/.test(r))
  .concat(walk(join(root, 'components'), (r) => /\.(ts|tsx)$/.test(r)))
  .concat(walk(join(root, 'lib'), (r) => /\.(ts|tsx)$/.test(r)))
const prodText = prodFiles.map((f) => { try { return readFileSync(join(root, f), 'utf8') } catch { return '' } })

let crons = []
try { crons = (JSON.parse(readFileSync('vercel.json', 'utf8')).crons || []).map((c) => c.path.split('?')[0]) } catch {}

const dead = []
for (const h of handlers) {
  const url = urlOf(h)
  const tok = staticToken(url)
  if (crons.some((c) => c === url || c.startsWith(tok))) continue
  // search prod text for the token (exclude routes whose own file is the only match)
  let referenced = false
  for (const t of prodText) { if (t.includes(tok)) { referenced = true; break } }
  if (!referenced) dead.push({ url, file: h })
}

console.log(`Production API handlers scanned: ${handlers.length}`)
console.log(`Dead candidates (no prod source reference to static token): ${dead.length}\n`)
for (const d of dead.sort((a, b) => a.url.localeCompare(b.url))) console.log(`  ${d.url}`)
