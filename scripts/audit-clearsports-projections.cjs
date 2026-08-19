#!/usr/bin/env node
/**
 * READ-ONLY probe of the ClearSports projections feed — the sole upstream for
 * FantasyProjection (see app/api/cron/import-projections/route.ts).
 *
 * Traces the exact failure chain that leaves the table empty:
 *   provider-config.ts:176  no API key      -> getClearSportsConfigFromEnv() = null
 *   client.ts:83            no config       -> clearSportsFetch() = null
 *   index.ts:175            null            -> rowsFrom() = []
 *   route.ts:175            []              -> writes 0 rows, returns ok:true
 *
 * Never prints the API key. Makes one GET. No writes.
 */
const fs = require('fs')
const path = require('path')

const KEY_KEYS = ['CLEARSPORTS_API_KEY', 'CLEAR_SPORTS_API_KEY', 'CLEARSPORTS_KEY']
const BASE_KEYS = ['CLEARSPORTS_API_BASE', 'CLEAR_SPORTS_API_BASE', 'CLEARSPORTS_BASE_URL', 'CLEAR_SPORTS_BASE_URL']
const DEFAULT_BASE = 'https://api.clearsportsapi.com/api/v1'

// Minimal .env loader (no dependency on dotenv being installed).
function loadEnvFiles() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      const k = m[1]
      let v = m[2].trim().replace(/^["']|["']$/g, '')
      if (process.env[k] == null) process.env[k] = v
    }
  }
}

function firstEnv(keys) {
  for (const k of keys) {
    const v = process.env[k]
    if (v != null && String(v).trim() !== '') return { key: k, value: String(v).trim() }
  }
  return null
}

async function main() {
  loadEnvFiles()
  const sport = (process.argv[2] || 'nfl').toLowerCase()

  console.log('\n=== ClearSports projections probe ===\n')

  const key = firstEnv(KEY_KEYS)
  const base = firstEnv(BASE_KEYS)

  console.log(`API key:  ${key ? `SET (via ${key.key}, ${key.value.length} chars)` : 'MISSING'}`)
  console.log(`Base URL: ${base ? `${base.value} (via ${base.key})` : `${DEFAULT_BASE} (default)`}`)

  if (!key) {
    console.log('\n=> ROOT CAUSE CONFIRMED (locally).')
    console.log('   getClearSportsConfigFromEnv() returns null, so clearSportsFetch()')
    console.log('   returns null before making any request. The cron then writes 0 rows')
    console.log('   and reports ok:true. Check Vercel Production for the same variable.')
    return
  }

  // Try the configured base first, then the code's built-in default. A wrong
  // CLEARSPORTS_API_BASE silently overrides a working default with a dead host.
  const candidates = []
  const configured = (base?.value || DEFAULT_BASE).replace(/\/+$/, '')
  candidates.push({ label: base ? `configured (${base.key})` : 'default', baseUrl: configured })
  if (configured !== DEFAULT_BASE) {
    candidates.push({ label: 'code default (DEFAULT_CLEARSPORTS_BASE_URL)', baseUrl: DEFAULT_BASE })
  }

  let res = null
  let baseUrl = null
  for (const c of candidates) {
    const url = `${c.baseUrl}/${sport}/projections`
    console.log(`\nGET ${url}`)
    console.log(`     [${c.label}]`)
    const started = Date.now()
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${key.value}`, 'Content-Type': 'application/json' },
      })
      console.log(`status: ${r.status} ${r.statusText} (${Date.now() - started}ms)`)
      res = r
      baseUrl = c.baseUrl
      if (r.ok) break
    } catch (e) {
      console.log(`=> request failed: ${e.message}  (host unreachable / DNS)`)
    }
  }

  if (!res) {
    console.log('\n=> NO base URL reachable. If the code default also fails, the outage is')
    console.log('   upstream or network-level, not configuration.')
    return
  }
  if (baseUrl !== configured && res.ok) {
    console.log(`\n*** CLEARSPORTS_API_BASE is WRONG. "${configured}" is unreachable;`)
    console.log(`    "${baseUrl}" works. Remove the override (or set it to this) in`)
    console.log('    .env AND Vercel Production.')
  }

  const text = await res.text()
  if (!res.ok) {
    console.log(`body (first 300): ${text.slice(0, 300)}`)
    console.log('\n=> Endpoint is reachable but not returning data. Either the plan does not')
    console.log('   include projections, or the path differs from "<league>/projections".')
    return
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    console.log(`=> non-JSON response (first 200): ${text.slice(0, 200)}`)
    return
  }

  const rows = Array.isArray(json) ? json : Array.isArray(json?.projections) ? json.projections : null
  if (!rows) {
    console.log(`=> 200 OK but no array found. Top-level keys: ${Object.keys(json || {}).join(', ') || '(none)'}`)
    return
  }

  console.log(`rows: ${rows.length}`)
  if (rows.length === 0) {
    console.log('=> Empty feed. Likely preseason, or requires a season/week parameter.')
    return
  }

  const sample = rows[0]
  console.log(`\nfirst row keys: ${Object.keys(sample).join(', ')}`)

  // Does the shape satisfy persistProjectionRows()? It needs an id-or-name AND
  // a finite number from one of these fields, else it `continue`s past the row.
  const id = sample.playerId ?? sample.id ?? sample.player_id
  const name = sample.name ?? sample.playerName ?? sample.player
  const pts = sample.projectedPoints ?? sample.points ?? sample.fpts ?? sample.fantasyPoints ?? sample.projection

  console.log('\n--- persistProjectionRows() compatibility ---')
  console.log(`  id field:     ${id != null ? `OK (${id})` : 'MISSING'}`)
  console.log(`  name field:   ${name != null ? `OK (${name})` : 'MISSING'}`)
  console.log(`  points field: ${Number.isFinite(Number(pts)) ? `OK (${pts})` : `MISSING/non-numeric (${pts})`}`)
  console.log(
    (id != null || name != null) && Number.isFinite(Number(pts))
      ? '\n=> Shape is compatible. If the table is still empty, the key is missing in\n   Vercel Production specifically (this probe used your LOCAL env).'
      : '\n=> SHAPE MISMATCH. Rows arrive but persistProjectionRows() skips every one,\n   so the cron writes 0 and still reports ok:true. Field mapping needs updating.',
  )
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  process.exitCode = 1
})
