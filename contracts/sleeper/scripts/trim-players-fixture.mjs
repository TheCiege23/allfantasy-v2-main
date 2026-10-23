#!/usr/bin/env node
/**
 * Trim a raw Sleeper `players/{sport}` download into a committable fixture.
 *
 * Usage (called by probe.sh, not by hand):
 *   node trim-players-fixture.mjs <raw.json> <out.json> --sport=nba --url=... --http-status=200 --bytes=N
 *
 * The output keeps ~20 player entries VERBATIM (every key Sleeper sent, untouched) and adds a
 * summary computed over the WHOLE feed: total entries, how many carry a numeric `years_exp`, and
 * the distribution of `years_exp` values. The summary is what answers "does this field exist for
 * this sport"; the sample is what tests parse.
 *
 * Selection is deterministic so a re-run on the same payload writes the same file:
 *   - named cross-check players (long-tenured veterans and recent top picks), when present
 *   - up to 4 `years_exp: 0` players on a team (the first-year question)
 *   - up to 3 `years_exp >= 10` players
 *   - up to 2 entries with no numeric `years_exp` (so the "unknown" shape is pinned too)
 *   - then one player per remaining `years_exp` value, until ~20
 * Node built-ins only.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [rawPath, outPath, ...flags] = process.argv.slice(2)
if (!rawPath || !outPath) {
  console.error('usage: trim-players-fixture.mjs <raw.json> <out.json> [--sport=] [--url=] [--http-status=] [--bytes=]')
  process.exit(1)
}
const opt = Object.fromEntries(
  flags.map((f) => {
    const [k, ...v] = f.replace(/^--/, '').split('=')
    return [k, v.join('=')]
  }),
)

const feed = JSON.parse(readFileSync(rawPath, 'utf8'))
if (!feed || typeof feed !== 'object' || Array.isArray(feed)) {
  console.error(`ERROR: expected an object keyed by player id, got ${Array.isArray(feed) ? 'array' : typeof feed}`)
  process.exit(1)
}

const TARGET = 20
const NAMED = [
  'LeBron James',
  'Stephen Curry',
  'Chris Paul',
  'Kevin Durant',
  'Victor Wembanyama',
  'Cooper Flagg',
  'AJ Dybantsa',
  'Darryn Peterson',
  'Cameron Boozer',
]

const entries = Object.entries(feed)
const nameOf = (p) => String(p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ')).trim()
const numericYe = (p) => typeof p?.years_exp === 'number' && Number.isFinite(p.years_exp)

// ---- summary over the whole feed ------------------------------------------------------------
const distribution = {}
const yearsExpTypes = {}
const keyFrequency = {}
const positions = {}
let withNumeric = 0
let withTeam = 0
let active = 0
let keyMatchesPlayerId = 0
for (const [key, p] of entries) {
  const t = p?.years_exp === null ? 'null' : typeof p?.years_exp
  yearsExpTypes[t] = (yearsExpTypes[t] ?? 0) + 1
  if (numericYe(p)) {
    withNumeric += 1
    distribution[p.years_exp] = (distribution[p.years_exp] ?? 0) + 1
  }
  if (p?.team) withTeam += 1
  if (p?.active === true) active += 1
  if (String(p?.player_id ?? '') === key) keyMatchesPlayerId += 1
  const pos = p?.position ?? '(none)'
  positions[pos] = (positions[pos] ?? 0) + 1
  for (const k of Object.keys(p ?? {})) keyFrequency[k] = (keyFrequency[k] ?? 0) + 1
}
const onTeamDistribution = {}
for (const [, p] of entries) {
  if (p?.team && numericYe(p)) onTeamDistribution[p.years_exp] = (onTeamDistribution[p.years_exp] ?? 0) + 1
}

// ---- sample ---------------------------------------------------------------------------------
const picked = new Map()
const take = (key, why) => {
  if (picked.size >= TARGET + 6 || picked.has(key)) return
  picked.set(key, why)
}
const byName = new Map()
for (const [key, p] of entries) {
  const n = nameOf(p)
  if (!byName.has(n)) byName.set(n, [])
  byName.get(n).push(key)
}
const namedFound = {}
for (const n of NAMED) {
  const keys = byName.get(n) ?? []
  namedFound[n] = keys.map((k) => ({ player_id: k, years_exp: feed[k]?.years_exp ?? null, team: feed[k]?.team ?? null }))
  // A name on several entries: keep the one on a team (the active player), else the first.
  const best = keys.find((k) => feed[k]?.team) ?? keys[0]
  if (best) take(best, `named cross-check: ${n}`)
}
const sortedKeys = entries.map(([k]) => k).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
const pickWhere = (pred, max, why) => {
  let n = 0
  for (const k of sortedKeys) {
    if (n >= max) break
    if (picked.has(k)) continue
    if (pred(feed[k])) {
      take(k, why)
      n += 1
    }
  }
}
pickWhere((p) => numericYe(p) && p.years_exp === 0 && Boolean(p.team), 4, 'years_exp 0 on a team')
pickWhere((p) => numericYe(p) && p.years_exp >= 10, 3, 'years_exp >= 10')
pickWhere((p) => !numericYe(p), 2, 'no numeric years_exp')
for (const v of Object.keys(distribution).map(Number).sort((a, b) => a - b)) {
  if (picked.size >= TARGET) break
  if ([...picked.keys()].some((k) => feed[k]?.years_exp === v)) continue
  pickWhere((p) => numericYe(p) && p.years_exp === v && Boolean(p.team), 1, `years_exp ${v}`)
}

const players = {}
const selection = {}
for (const [k, why] of picked) {
  players[k] = feed[k]
  selection[k] = why
}

const out = {
  _probe: {
    endpoint: `players/${opt.sport ?? '?'}`,
    url: opt.url ?? null,
    http_status: Number(opt['http-status'] ?? NaN) || null,
    raw_bytes: Number(opt.bytes ?? NaN) || null,
    captured_at: new Date().toISOString(),
    note:
      'TRIMMED. `players` is a verbatim subset of the feed (every key as sent); `summary` is computed over ALL entries. ' +
      'Produced by contracts/sleeper/scripts/probe.sh -> trim-players-fixture.mjs.',
  },
  summary: {
    total_entries: entries.length,
    key_equals_player_id: keyMatchesPlayerId,
    with_numeric_years_exp: withNumeric,
    years_exp_value_types: yearsExpTypes,
    years_exp_distribution: distribution,
    years_exp_distribution_on_a_team: onTeamDistribution,
    with_team: withTeam,
    active_true: active,
    positions,
    key_frequency: keyFrequency,
    named_cross_checks: namedFound,
  },
  selection,
  players,
}

writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`)
console.error(
  `entries=${entries.length} numeric_years_exp=${withNumeric} with_team=${withTeam} sample=${picked.size}`,
)
console.error(`years_exp distribution: ${JSON.stringify(distribution)}`)
console.error(`named: ${JSON.stringify(namedFound)}`)
