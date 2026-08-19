#!/usr/bin/env node
/**
 * READ-ONLY surface map of the ClearSports API.
 *
 * The configured host (api.clearsports.com) does not resolve; the code default
 * (api.clearsportsapi.com/api/v1) resolves but 404s "nfl/projections". This
 * probe determines which base path and which dataTypes actually exist, so we can
 * tell three very different situations apart:
 *
 *   a) base path wrong        -> every dataType 404s here, some other base works
 *   b) projections unavailable-> teams/players/games 200 but projections 404
 *   c) auth/plan issue        -> 401/403 rather than 404
 *
 * Endpoint list mirrors lib/clear-sports/index.ts. No writes.
 */
const fs = require('fs')
const path = require('path')

const KEY_KEYS = ['CLEARSPORTS_API_KEY', 'CLEAR_SPORTS_API_KEY', 'CLEARSPORTS_KEY']

const BASES = [
  'https://api.clearsportsapi.com/api/v1',
  'https://api.clearsportsapi.com/v1',
  'https://api.clearsportsapi.com/api',
  'https://api.clearsportsapi.com',
]

// Paths exactly as lib/clear-sports/index.ts builds them, for league "nfl".
const PATHS = ['nfl/teams', 'nfl/players', 'nfl/games', 'nfl/projections', 'nfl/rankings', 'nfl/player-stats']

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

function firstEnv(keys) {
  for (const k of keys) {
    const v = process.env[k]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

async function probe(url, key) {
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    let hint = ''
    if (r.ok) {
      const t = await r.text()
      try {
        const j = JSON.parse(t)
        const arr = Array.isArray(j) ? j : Object.values(j).find((v) => Array.isArray(v))
        hint = Array.isArray(arr) ? `${arr.length} rows` : `keys: ${Object.keys(j).slice(0, 6).join(',')}`
      } catch {
        hint = `${t.length}b non-JSON`
      }
    }
    return { status: r.status, hint }
  } catch (e) {
    return { status: 0, hint: e.name === 'TimeoutError' ? 'timeout' : 'unreachable' }
  }
}

async function main() {
  loadEnvFiles()
  const key = firstEnv(KEY_KEYS)
  if (!key) {
    console.log('No API key found locally. Cannot probe.')
    return
  }
  console.log(`\n=== ClearSports surface map (key: ${key.length} chars) ===`)

  for (const base of BASES) {
    console.log(`\n--- ${base} ---`)
    let anyOk = false
    for (const p of PATHS) {
      const { status, hint } = await probe(`${base}/${p}`, key)
      const mark = status === 200 ? 'OK ' : status === 0 ? '   ' : '   '
      console.log(`  ${mark}${String(status).padStart(3)}  ${p.padEnd(18)} ${hint}`)
      if (status === 200) anyOk = true
      if (status === 0) break // host unreachable, skip remaining paths
    }
    if (anyOk) {
      console.log(`  => THIS BASE WORKS. Set CLEARSPORTS_API_BASE=${base}`)
    }
  }

  console.log('\nReading the result:')
  console.log('  200 on teams/players but 404 on projections -> provider has no projections feed;')
  console.log('     FantasyProjection needs a different source, not a config fix.')
  console.log('  401/403 everywhere -> key invalid or plan lapsed.')
  console.log('  404 everywhere on every base -> API surface changed entirely.')
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  process.exitCode = 1
})
