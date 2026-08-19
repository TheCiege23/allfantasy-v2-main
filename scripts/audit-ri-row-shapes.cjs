#!/usr/bin/env node
/**
 * READ-ONLY shape dump of the Rolling Insights rows the projection engine will
 * consume. Answers two questions that decide Phase 1/2 design:
 *
 * 1. WOULD persistProjectionRows() MISREAD player-stats AS PROJECTIONS?
 *    buildRestPathCandidates() maps dataType 'projections' -> player-stats/{year}/{SPORT},
 *    which is HISTORICAL production. persistProjectionRows() then reads
 *    `row.projectedPoints ?? row.points ?? row.fpts ?? row.fantasyPoints ?? row.projection`.
 *    If any of those keys exist on a player-stats row, last season's totals would
 *    have been written to FantasyProjection.projectedPoints and rendered as a
 *    forecast. The only reason that never shipped is the 304 for season 2026.
 *
 * 2. WHAT STAT COMPONENTS ARE AVAILABLE for computing real projections into
 *    AFProjectionSnapshot, and does coverage include IDP/defensive players?
 *
 * Prints field NAMES and one redacted sample. No writes.
 */
const fs = require('fs')
const path = require('path')

const TOKEN_KEYS = [
  'ROLLING_INSIGHTS_RSC_TOKEN',
  'ROLLING_INSIGHTS_RSC_TOKEN2',
  'RSC_TOKEN',
  'ROLLING_INSIGHTS_CLIENT_SECRET',
]

const IDP = new Set(['DL','LB','DB','DE','DT','CB','S','SS','FS','OLB','ILB','MLB','EDGE','IDP'])

// persistProjectionRows() reads these, in this order.
const PROJECTION_FIELDS = ['projectedPoints', 'points', 'fpts', 'fantasyPoints', 'projection']
const ID_FIELDS = ['playerId', 'id', 'player_id']

function loadEnvFiles() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      if (process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

function token() {
  for (const k of TOKEN_KEYS) {
    const v = process.env[k]
    if (v && String(v).trim()) return String(v).trim()
  }
  return null
}

function base() {
  const raw =
    process.env.ROLLING_INSIGHTS_REST_BASE_URL?.trim() ||
    process.env.ROLLING_INSIGHTS_REST_BASE?.trim() ||
    'https://rest.datafeeds.rolling-insights.com/api/v1'
  const t = raw.replace(/\/+$/, '')
  return /\/api\/v\d+$/.test(t) ? t : `${t}/api/v1`
}

async function get(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!r.ok) return { status: r.status, rows: null }
  const j = await r.json()
  const d = j?.data ?? j
  const rows = Array.isArray(d) ? d : Array.isArray(d?.NFL) ? d.NFL : null
  return { status: r.status, rows, raw: d }
}

function flatKeys(obj, prefix = '', out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 2) return out
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatKeys(v, key, out, depth + 1)
    else out.push(key)
  }
  return out
}

async function main() {
  loadEnvFiles()
  const tok = token()
  if (!tok) return console.log('No RSC token found. Run: vercel env pull .env.local')
  const b = base()
  const season = process.argv[2] || '2025'
  const q = `?RSC_token=${encodeURIComponent(tok)}`

  console.log(`\n=== RI row shapes — season ${season} ===`)

  // ---- player-stats: the misread risk + the projection base ----------------
  const ps = await get(`${b}/player-stats/${season}/NFL${q}`)
  console.log(`\n--- player-stats/${season}/NFL  (status ${ps.status}, ${ps.rows?.length ?? 0} rows) ---`)
  if (ps.rows?.length) {
    const r = ps.rows[0]
    const keys = flatKeys(r)
    console.log(`top-level keys (${Object.keys(r).length}): ${Object.keys(r).join(', ')}`)
    console.log(`\nflattened (${keys.length}): ${keys.slice(0, 60).join(', ')}${keys.length > 60 ? ' …' : ''}`)

    console.log('\n  >> persistProjectionRows() MISREAD CHECK')
    let misread = null
    for (const f of PROJECTION_FIELDS) {
      if (r[f] != null && Number.isFinite(Number(r[f]))) { misread = { f, v: r[f] }; break }
    }
    const idHit = ID_FIELDS.find((f) => r[f] != null)
    if (misread) {
      console.log(`     DANGER: row.${misread.f} = ${misread.v} would be written as`)
      console.log(`     FantasyProjection.projectedPoints — i.e. ${season} ACTUALS shown as a forecast.`)
      console.log(`     id field present: ${idHit ?? 'none'}`)
    } else {
      console.log(`     safe: none of ${PROJECTION_FIELDS.join('/')} present at top level;`)
      console.log(`     every row would be skipped (still 0 written, still ok:true today).`)
    }

    // Row 0 alone is misleading — it may be a defensive player, whose
    // regular_season block differs entirely from a QB's. Union across ALL rows
    // to see the true stat-component surface available to the engine.
    const statKeyCounts = new Map()
    let withRegular = 0
    for (const row of ps.rows) {
      const rs = row.regular_season
      if (!rs || typeof rs !== 'object') continue
      withRegular += 1
      for (const k of Object.keys(rs)) statKeyCounts.set(k, (statKeyCounts.get(k) || 0) + 1)
    }
    console.log(`\n  >> regular_season stat components (union over ${withRegular} rows)`)
    const stats = [...statKeyCounts.entries()].sort((a, b) => b[1] - a[1])
    for (const [k, n] of stats) {
      console.log(`     ${k.padEnd(30)} present on ${String(n).padStart(5)} rows`)
    }
    if (stats.length === 0) console.log('     (none — regular_season is empty on every row)')

    // Which offensive components exist? These drive QB/RB/WR/TE projections.
    const OFF = ['passing', 'rushing', 'receiving', 'receptions', 'targets', 'yards', 'touchdown']
    const offHits = stats.filter(([k]) => OFF.some((o) => k.toLowerCase().includes(o)))
    console.log(`\n  >> offensive components found: ${offHits.length ? offHits.map(([k]) => k).join(', ') : 'NONE'}`)
    if (!offHits.length) {
      console.log('     WARNING: without passing/rushing/receiving volume there is no basis for')
      console.log('     QB/RB/WR/TE projections. Defensive-only stats cannot carry the engine.')
    }

    // Sample a row that has the most populated regular_season block.
    let best = null
    let bestN = -1
    for (const row of ps.rows) {
      const n = row.regular_season && typeof row.regular_season === 'object' ? Object.keys(row.regular_season).length : 0
      if (n > bestN) { bestN = n; best = row }
    }
    if (best) {
      console.log(`\n  >> richest row (${bestN} components): ${best.player} (${best.team})`)
      console.log(`     ${JSON.stringify(best.regular_season).slice(0, 600)}`)
    }
  }

  // ---- depth-charts: opportunity share ------------------------------------
  const dc = await get(`${b}/depth-charts/NFL${q}`)
  console.log(`\n--- depth-charts/NFL  (status ${dc.status}) ---`)
  if (dc.raw) {
    const nfl = dc.raw.NFL ?? dc.raw
    const sample = Array.isArray(nfl) ? nfl[0] : nfl?.[Object.keys(nfl)[0]]
    console.log(`shape: ${Array.isArray(nfl) ? `array(${nfl.length})` : `object keys: ${Object.keys(nfl).slice(0, 8).join(', ')}`}`)
    console.log(`sample keys: ${flatKeys(sample).slice(0, 30).join(', ')}`)
  }

  // ---- injuries: availability ---------------------------------------------
  const inj = await get(`${b}/injuries/NFL${q}`)
  console.log(`\n--- injuries/NFL  (status ${inj.status}, ${inj.rows?.length ?? 0} rows) ---`)
  if (inj.rows?.length) {
    console.log(`sample keys: ${flatKeys(inj.rows[0]).slice(0, 30).join(', ')}`)
  }

  console.log('\n>> The id field on these rows is the Phase 1 risk: RI ids are NOT canonical')
  console.log('   AF ids. Resolve via lib/player-match/verifiedNameMatch.ts or repeat the')
  console.log('   exact failure already measured (rows exist, join to nothing).')
}

main().catch((e) => {
  console.error('failed:', e.message)
  process.exitCode = 1
})
