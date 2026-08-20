#!/usr/bin/env node
// =============================================================================
// TheSportsDB fixture probe — ONE-TIME capture tool. NOT for runtime.
//
// Node port of probe.sh. Exists because probe.sh needs `jq`, which is not
// available on this Windows box; this needs nothing but Node.
//
//   node contracts/thesportsdb/scripts/probe.mjs            # capture the plan
//   node contracts/thesportsdb/scripts/probe.mjs --dry-run  # print, call nothing
//
// SAFETY
//   - v1 puts the API key in the URL *path*. Never log a full URL.
//   - v1 returns HTTP 200 on errors. The real error is `.Message` (capital M).
//   - A null top-level value is MEANINGFUL ("endpoint exists, no data for this
//     entity"), not a failure. Record it; do not retry.
// =============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(HERE, '..', 'fixtures')
const V1 = 'https://www.thesportsdb.com/api/v1/json'

// Load exactly ONE env file. Loading .env.local and .env together has burned us
// before (a test key paired with live ids manufactured a fake outage), so this
// picks the first file that carries the key and stops there.
function loadKey() {
  for (const file of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), file)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i === -1) continue
      if (t.slice(0, i).trim() !== 'THESPORTSDB_API_KEY') continue
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (v) return { key: v, source: file }
    }
  }
  return { key: '123', source: 'fallback free key' }
}

const { key: KEY, source: KEY_SOURCE } = loadKey()
const IS_FREE_KEY = KEY === '123' || KEY === '3'

// Season context. GAPS.md is explicit that an unlabelled off-season null is
// indistinguishable from an unsupported endpoint, and that ambiguity is the
// whole reason the re-probing loop exists. Every fixture carries this.
const SEASON_PHASE = 'preseason' // 2026-08-17: NFL preseason, NCAAF not yet started
const CAPTURED_AT = new Date().toISOString()

const NFL = 4391
const NCAAF = 4479
const KNOWN_NFL_PLAYER = '34201502' // Jalen Hurts — GAPS.md R-04
const KNOWN_NFL_EVENT = '2475349' // GAPS.md R-01..R-03 recorded nulls here

/** @type {{name:string, endpoint:string, params:Record<string,string>, why:string}[]} */
const PLAN = [
  { name: 'lookupleague.NFL', endpoint: 'lookupleague.php', params: { id: String(NFL) }, why: 'confirm R-05 idLeague 4391' },
  { name: 'lookupleague.NCAAF', endpoint: 'lookupleague.php', params: { id: String(NCAAF) }, why: 'confirm R-06 idLeague 4479' },
  // lookup_all_teams.php?id=<league> 404s — it is NOT a real v1 endpoint,
  // despite being listed in ENDPOINTS.yaml and called "working" by GAPS G-08.
  // search_all_teams.php?l=<strLeague> is the one that exists. Probed
  // 2026-08-17 on a paid key; see GAPS.md R-14.
  { name: 'search_all_teams.NFL', endpoint: 'search_all_teams.php', params: { l: 'NFL' }, why: 'team dimension — replaces the non-existent lookup_all_teams.php' },
  { name: 'search_all_teams.NCAAF', endpoint: 'search_all_teams.php', params: { l: 'NCAA Division 1' }, why: 'NCAAF teams; note strLeague, not the numeric id' },
  { name: 'all_leagues', endpoint: 'all_leagues.php', params: {}, why: 'truncation control — free key truncates, paid does not (R-08)' },
  { name: 'lookupplayer.NFL', endpoint: 'lookupplayer.php', params: { id: KNOWN_NFL_PLAYER }, why: '66-field FullPlayersResponse shape' },
  { name: 'lookupplayerstats.NFL', endpoint: 'lookupplayerstats.php', params: { id: KNOWN_NFL_PLAYER }, why: 'R-04 works for NFL; season aggregates only' },
  { name: 'lookupeventstats.NFL', endpoint: 'lookupeventstats.php', params: { id: KNOWN_NFL_EVENT }, why: 'R-01 expected NULL — re-record with season stamp' },
  { name: 'lookuptimeline.NFL', endpoint: 'lookuptimeline.php', params: { id: KNOWN_NFL_EVENT }, why: 'R-02 expected NULL' },
  { name: 'lookuplineup.NFL', endpoint: 'lookuplineup.php', params: { id: KNOWN_NFL_EVENT }, why: 'R-03 expected NULL' },
  { name: 'eventsnextleague.NFL', endpoint: 'eventsnextleague.php', params: { id: String(NFL) }, why: 'upcoming schedule shape' },
  { name: 'eventspastleague.NFL', endpoint: 'eventspastleague.php', params: { id: String(NFL) }, why: 'R-10 quarter scores as HTML in strResult' },
  { name: 'eventsnextleague.NCAAF', endpoint: 'eventsnextleague.php', params: { id: String(NCAAF) }, why: 'NCAAF schedule shape' },
  { name: 'eventspastleague.NCAAF', endpoint: 'eventspastleague.php', params: { id: String(NCAAF) }, why: 'NCAAF result shape' },
  { name: 'latestamericanfootball', endpoint: 'latestamericanfootball.php', params: {}, why: 'R-11 premium-gated on free key; G-02' },
  { name: 'latestncaafootball', endpoint: 'latestncaafootball.php', params: {}, why: 'R-11 premium-gated on free key' },
]

function redactedUrl(endpoint, params) {
  const qs = new URLSearchParams(params).toString()
  return `${V1}/***REDACTED***/${endpoint}${qs ? `?${qs}` : ''}`
}

function realUrl(endpoint, params) {
  const qs = new URLSearchParams(params).toString()
  return `${V1}/${encodeURIComponent(KEY)}/${endpoint}${qs ? `?${qs}` : ''}`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function probe(item) {
  const result = {
    name: item.name,
    endpoint: item.endpoint,
    params: item.params,
    why: item.why,
    redacted_url: redactedUrl(item.endpoint, item.params),
    captured_at: CAPTURED_AT,
    season_phase: SEASON_PHASE,
    key_tier: IS_FREE_KEY ? 'free' : 'paid-or-unknown',
    http_status: null,
    api_message: null,
    top_level_key: null,
    returned_null: null,
    row_count: null,
    error: null,
  }

  let res
  try {
    res = await fetch(realUrl(item.endpoint, item.params), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    result.error = `network: ${e instanceof Error ? e.message : String(e)}`
    return { result, body: null }
  }

  result.http_status = res.status
  const text = await res.text()

  let body
  try {
    body = JSON.parse(text)
  } catch {
    // R-11: some premium-gated endpoints return an empty body on the free key.
    result.error = text.trim() === '' ? 'empty body (premium-gated?)' : `non-JSON: ${text.slice(0, 120)}`
    return { result, body: null }
  }

  // v1 returns 200 on errors. The status code alone proves nothing.
  if (body && typeof body === 'object' && 'Message' in body) {
    result.api_message = String(body.Message)
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const keys = Object.keys(body)
    result.top_level_key = keys[0] ?? null
    const v = result.top_level_key ? body[result.top_level_key] : undefined
    result.returned_null = v === null
    result.row_count = Array.isArray(v) ? v.length : v == null ? 0 : 1
  }

  return { result, body }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  console.log(`key source : ${KEY_SOURCE}`)
  console.log(`key tier   : ${IS_FREE_KEY ? 'FREE (30/min, lists silently truncated, commercial use NOT licensed)' : 'paid or unknown'}`)
  console.log(`season     : ${SEASON_PHASE}  (captured_at ${CAPTURED_AT})`)
  console.log(`plan       : ${PLAN.length} probes, NFL(${NFL}) + NCAAF(${NCAAF})\n`)

  if (dryRun) {
    for (const p of PLAN) console.log(`  ${p.name.padEnd(28)} ${p.redacted_url ?? redactedUrl(p.endpoint, p.params)}`)
    console.log('\ndry run — no requests made')
    return
  }

  fs.mkdirSync(FIXTURE_DIR, { recursive: true })
  const manifest = []

  for (const [i, item] of PLAN.entries()) {
    const { result, body } = await probe(item)
    manifest.push(result)

    const status = result.error
      ? `ERROR ${result.error}`
      : result.api_message
        ? `API-ERROR "${result.api_message}"`
        : result.returned_null
          ? `NULL (meaningful — record, do not retry)`
          : `${result.row_count} row(s) under .${result.top_level_key}`

    console.log(`[${String(i + 1).padStart(2)}/${PLAN.length}] ${item.name.padEnd(28)} HTTP ${String(result.http_status ?? '---').padEnd(4)} ${status}`)

    if (body !== null) {
      // Fixture carries its own provenance. A bare body cannot tell a later
      // reader whether a null was an off-season artifact or a real absence.
      const fixture = { _probe: result, response: body }
      fs.writeFileSync(path.join(FIXTURE_DIR, `v1.${item.name}.json`), JSON.stringify(fixture, null, 2) + '\n')
    }

    if (i < PLAN.length - 1) await sleep(2500) // stay under the 30/min free cap
  }

  fs.writeFileSync(
    path.join(FIXTURE_DIR, '_manifest.json'),
    JSON.stringify({ captured_at: CAPTURED_AT, season_phase: SEASON_PHASE, key_tier: IS_FREE_KEY ? 'free' : 'paid-or-unknown', probes: manifest }, null, 2) + '\n'
  )

  const nulls = manifest.filter((m) => m.returned_null).length
  const errors = manifest.filter((m) => m.error || m.api_message).length
  console.log(`\nfixtures written to ${path.relative(process.cwd(), FIXTURE_DIR)}`)
  console.log(`  ${manifest.length - errors} captured, ${nulls} meaningful nulls, ${errors} errors/gated`)
  console.log('\nNEXT: commit fixtures + manifest together, update ENDPOINTS.yaml confidence, move GAPS.md rows.')
}

main()
