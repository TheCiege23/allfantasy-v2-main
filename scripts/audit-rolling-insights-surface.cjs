#!/usr/bin/env node
/**
 * READ-ONLY surface map of Rolling Insights REST (DataFeeds).
 *
 * DECISION CONTEXT (2026-08-10): the official RI NFL docs list NO projections
 * endpoint, and ClearSports 401s on every route that exists. Chosen path is to
 * COMPUTE AllFantasy projections from RI inputs into AFProjectionSnapshot
 * (baselineProjection / weatherAdjustment / afProjection / confidenceLevel).
 *
 * This probe answers the prerequisite: are RI credentials healthy, and which of
 * the inputs that engine needs are actually reachable?
 *
 *   player-stats   -> the projection base (usage, production)
 *   depth-charts   -> role/opportunity share
 *   injuries       -> availability + urgency (also powers slice 3)
 *   schedule       -> opponent + game timing (also powers slices 6/9)
 *
 * URL shape taken from buildRollingInsightsScheduleSeasonUrl():
 *   {restBase}/{endpoint}/{season}/{SPORT}?RSC_token=...
 *
 * Never prints the token (redacts it from all output). No writes.
 */
const fs = require('fs')
const path = require('path')

// Both spellings are configured in the wild and mean different things:
// _REST_BASE is the host root, _REST_BASE_URL includes /api/v1. Normalize.
function normalizeBase(v) {
  if (!v) return null
  const t = String(v).trim().replace(/\/+$/, '')
  if (!t) return null
  return /\/api\/v\d+$/.test(t) ? t : `${t}/api/v1`
}

function baseCandidates() {
  return [
    normalizeBase(process.env.ROLLING_INSIGHTS_REST_BASE_URL),
    normalizeBase(process.env.ROLLING_INSIGHTS_REST_BASE),
    'https://rest.datafeeds.rolling-insights.com/api/v1',
    'https://datafeeds.rolling-insights.com/api/v1',
  ].filter((v, i, a) => v && a.indexOf(v) === i)
}

const TOKEN_KEYS = [
  'ROLLING_INSIGHTS_RSC_TOKEN',
  'ROLLING_INSIGHTS_RSC_TOKEN2',
  'RSC_TOKEN',
  'ROLLING_INSIGHTS_CLIENT_SECRET',
  'ROLLING_INSIGHTS_CLIENT_SECRET2',
]

// Endpoints named in the official NFL docs. `seasoned` = takes /{season} first.
const ENDPOINTS = [
  { path: 'schedule-season', seasoned: true, why: 'opponent + game timing' },
  { path: 'weekly-schedule', seasoned: true, why: 'weekly slate' },
  { path: 'team-info', seasoned: false, why: 'team reference' },
  { path: 'team-season-stats', seasoned: true, why: 'team context (pace, volume)' },
  { path: 'team-stats', seasoned: true, why: 'team context — alt path name' },
  { path: 'player-info', seasoned: false, why: 'roster + position' },
  { path: 'player-stats', seasoned: true, why: 'PROJECTION BASE — usage/production' },
  { path: 'player-season-stats', seasoned: true, why: 'projection base — alt path name' },
  { path: 'injuries', seasoned: false, why: 'availability + urgency' },
  { path: 'depth-charts', seasoned: false, why: 'role / opportunity share' },
]

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

function firstToken() {
  for (const k of TOKEN_KEYS) {
    const v = process.env[k]
    if (v != null && String(v).trim() !== '') return { key: k, value: String(v).trim() }
  }
  return null
}

function redact(s, token) {
  return token ? String(s).split(token).join('<redacted>') : String(s)
}

function describe(json) {
  if (json == null) return 'null'
  if (Array.isArray(json)) return `array(${json.length})`
  if (typeof json !== 'object') return typeof json
  const data = json.data ?? json
  if (Array.isArray(data)) return `data: array(${data.length})`
  if (data && typeof data === 'object') {
    const k = Object.keys(data)
    const arrKey = k.find((x) => Array.isArray(data[x]))
    if (arrKey) return `data.${arrKey}: array(${data[arrKey].length})`
    return `data keys: ${k.slice(0, 6).join(',')}`
  }
  return `keys: ${Object.keys(json).slice(0, 6).join(',')}`
}

async function hit(url, token) {
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    const text = await r.text()
    let hint
    if (r.ok) {
      try {
        hint = describe(JSON.parse(text))
      } catch {
        hint = `${text.length}b non-JSON`
      }
    } else {
      hint = redact(text.slice(0, 90).replace(/\s+/g, ' '), token)
    }
    return { status: r.status, hint }
  } catch (e) {
    return { status: 0, hint: e.name === 'TimeoutError' ? 'timeout' : 'unreachable' }
  }
}

async function main() {
  loadEnvFiles()
  const sport = (process.argv[2] || 'NFL').toUpperCase()
  const season = process.argv[3] || String(new Date().getMonth() + 1 >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1)
  const token = firstToken()

  console.log('\n=== Rolling Insights REST surface map ===\n')
  console.log(`sport:  ${sport}`)
  console.log(`season: ${season}`)
  console.log(`token:  ${token ? `SET (${token.key}, ${token.value.length} chars)` : 'MISSING'}`)

  if (!token) {
    console.log('\n=> No RSC token present locally. Cannot probe.')
    console.log('   Checked: ' + TOKEN_KEYS.join(', '))
    return
  }

  for (const base of baseCandidates()) {
    const clean = base.replace(/\/+$/, '')
    console.log(`\n--- ${clean} ---`)
    let reachable = false
    for (const ep of ENDPOINTS) {
      const suffix = ep.seasoned ? `${ep.path}/${season}/${sport}` : `${ep.path}/${sport}`
      const url = `${clean}/${suffix}?RSC_token=${encodeURIComponent(token.value)}`
      const { status, hint } = await hit(url, token.value)
      const mark = status === 200 ? 'OK ' : '   '
      console.log(`  ${mark}${String(status).padStart(3)}  ${ep.path.padEnd(18)} ${hint}`)
      console.log(`            ${''.padEnd(18)} (${ep.why})`)
      if (status === 0) break
      if (status === 200) reachable = true
    }
    if (reachable) {
      console.log(`\n  => THIS BASE WORKS. Set ROLLING_INSIGHTS_REST_BASE_URL=${clean}`)
      break
    }
  }

  console.log('\nReading the result:')
  console.log('  player-stats + depth-charts + injuries all 200 -> the AF projection')
  console.log('     engine has its inputs; proceed to build AFProjectionSnapshot.')
  console.log('  401/403 everywhere -> RI credentials are dead too, and BOTH sports')
  console.log('     providers are down. That becomes the first thing to fix.')
}

main().catch((e) => {
  console.error('probe failed:', e.message)
  process.exitCode = 1
})
