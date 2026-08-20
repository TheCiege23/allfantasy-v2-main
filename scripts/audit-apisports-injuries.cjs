#!/usr/bin/env node
/**
 * READ-ONLY probe of API-Sports (american-football), the upstream for
 * `sportsInjury` via app/api/cron/import-injuries.
 *
 * WHY: prod `sportsInjury` is 17.2 DAYS stale on a cron that runs every 15
 * MINUTES, and `injuryReportRecord` is 103 days stale. Unlike the projections
 * outage this produces WRONG output rather than absent output — a player who has
 * been out for two weeks still renders as healthy, and `playerUrgency.ts` (the
 * "OUT and still starting, N minutes to lock" detection) computes off it.
 *
 * A hard stop on a fixed date usually means quota exhaustion or a lapsed plan,
 * which /status reports directly. Never prints the key. No writes.
 */
const fs = require('fs')
const path = require('path')

const BASE = 'https://v1.american-football.api-sports.io'
const KEY_KEYS = ['APISPORTS_API_KEY', 'APISPORTS_KEY', 'API_SPORTS_KEY', 'SPORTS_API_KEY']

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

function key() {
  for (const k of KEY_KEYS) {
    const v = process.env[k]
    if (v && String(v).trim()) return { key: k, value: String(v).trim() }
  }
  return null
}

async function get(pathname, apiKey) {
  const r = await fetch(`${BASE}${pathname}`, {
    headers: { 'x-apisports-key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: r.status, json, text }
}

async function main() {
  loadEnvFiles()
  const k = key()
  console.log('\n=== API-Sports (american-football) probe ===\n')
  console.log(`key: ${k ? `SET (${k.key}, ${k.value.length} chars)` : 'MISSING'}`)
  if (!k) {
    console.log(`\n=> No key locally. Checked: ${KEY_KEYS.join(', ')}`)
    return
  }

  // --- account status: quota / plan --------------------------------------
  const st = await get('/status', k.value)
  console.log(`\n--- /status (HTTP ${st.status}) ---`)
  const resp = st.json?.response
  if (resp) {
    const acct = resp.account ?? {}
    const sub = resp.subscription ?? {}
    const req = resp.requests ?? {}
    console.log(`  account:      ${acct.firstname ?? '?'} ${acct.lastname ?? ''} <${acct.email ?? '?'}>`)
    console.log(`  plan:         ${sub.plan ?? '?'}`)
    console.log(`  active:       ${sub.active ?? '?'}`)
    console.log(`  plan ends:    ${sub.end ?? '?'}`)
    console.log(`  requests:     ${req.current ?? '?'} / ${req.limit_day ?? '?'} today`)
    if (sub.active === false) {
      console.log('\n  *** SUBSCRIPTION INACTIVE — this alone stops all ingestion. ***')
    }
    if (req.limit_day != null && req.current != null && req.current >= req.limit_day) {
      console.log('\n  *** DAILY QUOTA EXHAUSTED. ***')
      console.log('  Note the cadence: import-injuries runs every 15 min = 96 runs/day,')
      console.log('  and each run FANS OUT over 32 teams (fetchAPISportsInjuriesViaTeamFanout)')
      console.log('  = ~3072 requests/day for NFL alone. A free/low tier cannot sustain that,')
      console.log('  which would burn the quota early each day and look like a hard stop.')
    }
  } else {
    console.log(`  body: ${st.text.slice(0, 300)}`)
  }
  if (st.json?.errors && Object.keys(st.json.errors).length) {
    console.log(`  errors: ${JSON.stringify(st.json.errors)}`)
  }

  // --- injuries for last + current season --------------------------------
  for (const season of ['2025', '2026']) {
    const r = await get(`/injuries?team=1&season=${season}`, k.value)
    const n = Array.isArray(r.json?.response) ? r.json.response.length : null
    console.log(`\n--- /injuries?team=1&season=${season} (HTTP ${r.status}) ---`)
    console.log(`  results: ${r.json?.results ?? n ?? '?'}`)
    if (r.json?.errors && Object.keys(r.json.errors).length) {
      console.log(`  errors:  ${JSON.stringify(r.json.errors)}`)
    }
    if (n) console.log(`  sample keys: ${Object.keys(r.json.response[0]).join(', ')}`)
  }

  console.log('\nReading the result:')
  console.log('  subscription inactive / quota exhausted -> billing or cadence fix, not code.')
  console.log('  200 with results:0 for 2026 -> season has not started; the 2026 rollover')
  console.log('     stopped it, exactly like import-projections. Needs a season fallback.')
  console.log('  401/403 -> key rotated or revoked.')
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  process.exitCode = 1
})
