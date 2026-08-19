#!/usr/bin/env node
/**
 * READ-ONLY shape dump of Rolling Insights `injuries/{SPORT}`.
 *
 * The response is 32 TEAM rows ({team, team_id, injuries}), so the per-player
 * fields live one level down. The normalizer must map onto SportsInjury:
 *   externalId (unique w/ sport+source), playerName, playerId, team, teamId,
 *   position, type, status, description, date, season, week
 *
 * `externalId` is the one that matters most: it is half the upsert key, so if
 * there is no stable per-injury id we must synthesize one deterministically or
 * every run creates duplicate rows instead of updating.
 *
 * No writes.
 */
const fs = require('fs')
const path = require('path')

const TOKEN_KEYS = ['ROLLING_INSIGHTS_RSC_TOKEN', 'ROLLING_INSIGHTS_RSC_TOKEN2', 'RSC_TOKEN', 'ROLLING_INSIGHTS_CLIENT_SECRET']

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

function base() {
  const raw = process.env.ROLLING_INSIGHTS_REST_BASE_URL?.trim() || process.env.ROLLING_INSIGHTS_REST_BASE?.trim() || 'https://rest.datafeeds.rolling-insights.com/api/v1'
  const t = raw.replace(/\/+$/, '')
  return /\/api\/v\d+$/.test(t) ? t : `${t}/api/v1`
}

async function main() {
  loadEnv()
  const tok = TOKEN_KEYS.map((k) => process.env[k]).find((v) => v && v.trim())
  if (!tok) return console.log('No RSC token. Run: vercel env pull .env.local')

  const sport = (process.argv[2] || 'NFL').toUpperCase()
  const r = await fetch(`${base()}/injuries/${sport}?RSC_token=${encodeURIComponent(tok.trim())}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  console.log(`\n=== RI injuries/${sport} (HTTP ${r.status}) ===\n`)
  if (!r.ok) return console.log((await r.text()).slice(0, 300))

  const j = await r.json()
  const teams = j?.data?.[sport] ?? j?.data ?? j
  const list = Array.isArray(teams) ? teams : Object.values(teams ?? {})
  console.log(`team rows: ${list.length}`)

  // Union every per-injury field across all teams, with occurrence counts, so a
  // sparse field on team 0 does not get missed.
  const fieldCounts = new Map()
  let totalInjuries = 0
  let firstInjury = null
  const statuses = new Map()
  const teamsWithNone = []

  for (const t of list) {
    const arr = t?.injuries
    const rows = Array.isArray(arr) ? arr : arr && typeof arr === 'object' ? Object.values(arr) : []
    if (rows.length === 0) teamsWithNone.push(t?.team ?? '?')
    for (const inj of rows) {
      if (!inj || typeof inj !== 'object') continue
      totalInjuries += 1
      if (!firstInjury) firstInjury = { team: t?.team, team_id: t?.team_id, ...inj }
      for (const k of Object.keys(inj)) fieldCounts.set(k, (fieldCounts.get(k) || 0) + 1)
      const st = String(inj.status ?? inj.injury_status ?? inj.designation ?? '').trim()
      if (st) statuses.set(st, (statuses.get(st) || 0) + 1)
    }
  }

  console.log(`total injury rows: ${totalInjuries}`)
  console.log(`teams reporting none: ${teamsWithNone.length}`)

  console.log('\n--- per-injury fields (union across all teams) ---')
  for (const [k, n] of [...fieldCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(26)} on ${String(n).padStart(4)} rows`)
  }

  console.log('\n--- status vocabulary (drives urgency severity mapping) ---')
  for (const [s, n] of [...statuses.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(20)} ${n}`)
  }

  console.log('\n--- first full injury row ---')
  console.log(JSON.stringify(firstInjury, null, 2).slice(0, 900))

  // externalId feasibility: is there a stable per-injury identifier?
  const idish = [...fieldCounts.keys()].filter((k) => /(^id$|_id$|injury_id|player_id)/i.test(k))
  console.log('\n--- externalId candidates ---')
  console.log(`  ${idish.length ? idish.join(', ') : 'NONE — must synthesize deterministically'}`)
  if (!idish.length) {
    console.log('  Without a stable id, key on `${playerId||name}:${sport}` so repeat runs UPDATE')
    console.log('  the same row. Anything time-based (date, index) creates a new row per run.')
  }
}

main().catch((e) => {
  console.error('failed:', e.message)
  process.exitCode = 1
})
