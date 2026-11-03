#!/usr/bin/env node
/**
 * Redact one league's three raw `fxea` responses into ONE committable fixture. Called by probe.sh.
 *
 *   node redact-capture.mjs <dir holding getLeagueInfo.json, getTeamRosters.json, getStandings.json> <leagueId> <out.json> <baseUrl>
 *
 * Makes no request itself: probe.sh fetches, and passes its base URL in only so the fixture can
 * record where the capture came from.
 *
 * Prints the key paths of the RAW responses first (array indices collapsed to []), and any key
 * that looks like a picture, so the question being asked is answered before redaction can hide it.
 * Refuses to write when the redacted fixture still contains the league id, a team id or a team name.
 */
import fs from 'node:fs'
import path from 'node:path'

const [dir, leagueId, out, baseUrl] = process.argv.slice(2)
if (!dir || !leagueId || !out || !baseUrl) {
  console.error('usage: redact-capture.mjs <dir> <leagueId> <out.json> <baseUrl>')
  process.exit(2)
}

const ENDPOINTS = ['getLeagueInfo', 'getTeamRosters', 'getStandings']
const raw = {}
for (const ep of ENDPOINTS) {
  const text = fs.readFileSync(path.join(dir, `${ep}.json`), 'utf8')
  let body
  try {
    body = JSON.parse(text)
  } catch {
    console.error(`ERROR: ${ep} did not return JSON (Fantrax answers some bad ids with an HTML page).`)
    process.exit(1)
  }
  // Fantrax reports errors with HTTP 200 and an `error` object in the body.
  if (body && typeof body === 'object' && !Array.isArray(body) && body.error) {
    console.error(`ERROR: ${ep} answered with an error body: ${JSON.stringify(body.error).slice(0, 300)}`)
    process.exit(1)
  }
  raw[ep] = body
}

function paths(v, prefix = '', acc = new Set()) {
  if (Array.isArray(v)) {
    acc.add(`${prefix}[]`)
    for (const x of v) paths(x, `${prefix}[]`, acc)
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const p = prefix ? `${prefix}.${k}` : k
      acc.add(p)
      paths(x, p, acc)
    }
  }
  return acc
}

// Keys that are ids are collapsed so 140 teams do not print 140 copies of the same shape.
const info = raw.getLeagueInfo ?? {}
const rosters = raw.getTeamRosters?.rosters ?? {}
const standings = Array.isArray(raw.getStandings) ? raw.getStandings : []
const teamIds = new Set([...Object.keys(info.teamInfo ?? {}), ...Object.keys(rosters), ...standings.map((s) => s?.teamId).filter(Boolean)])
const collapse = (p) => p.split('.').map((seg) => (teamIds.has(seg) ? '<teamId>' : seg)).join('.')

const PICTURE = /logo|image|img|avatar|icon|photo|pic|url/i
console.error('--- key paths returned (raw, before redaction) ---')
const pictureKeys = []
for (const ep of ENDPOINTS) {
  const all = [...new Set([...paths(raw[ep])].map(collapse))].filter((p) => !p.startsWith('playerInfo.'))
  for (const p of all.sort()) {
    console.error(`${ep}: ${p}`)
    if (PICTURE.test(p.split('.').pop() ?? '')) pictureKeys.push(`${ep}: ${p}`)
  }
}
console.error('--- keys that look like a picture ---')
console.error(pictureKeys.length ? pictureKeys.join('\n') : '(none)')

// Placeholders, one per team, consistent across all three endpoints.
const order = [...teamIds].sort()
const teamPlaceholder = new Map(order.map((id, i) => [id, `team${String(i + 1).padStart(2, '0')}`]))
const nameOf = new Map()
for (const [id, t] of Object.entries(info.teamInfo ?? {})) if (t?.name) nameOf.set(String(t.name), id)
for (const [id, r] of Object.entries(rosters)) if (r?.teamName) nameOf.set(String(r.teamName), id)
for (const s of standings) if (s?.teamName && s?.teamId) nameOf.set(String(s.teamName), s.teamId)
// Matchups name each side by id, name AND a short name; the short name is a second team identity.
const shortOf = new Map()
for (const m of Array.isArray(info.matchups) ? info.matchups : [])
  for (const pair of Array.isArray(m?.matchupList) ? m.matchupList : [])
    for (const side of [pair?.home, pair?.away])
      if (side?.id && side?.shortName && teamPlaceholder.has(side.id)) shortOf.set(String(side.shortName), side.id)
const leagueName = typeof info.leagueName === 'string' ? info.leagueName : null

const PERSON = /owner|manager|user|email|nick|commissioner|historyid/i
function scrubString(key, s) {
  if (s === leagueId) return '<league>'
  if (leagueName && s === leagueName) return 'League'
  if (teamPlaceholder.has(s)) return teamPlaceholder.get(s)
  if (nameOf.has(s)) return `Team ${teamPlaceholder.get(nameOf.get(s)).slice(4)}`
  if (key === 'shortName' && shortOf.has(s)) return `T${teamPlaceholder.get(shortOf.get(s)).slice(4)}`
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      const ext = path.extname(u.pathname)
      return `${u.protocol}//${u.host}/<path withheld>${ext}`
    } catch {
      return '<url withheld>'
    }
  }
  if (key && PERSON.test(key)) return '<withheld>'
  let t = s.split(leagueId).join('<league>')
  if (leagueName) t = t.split(leagueName).join('League')
  return t
}
function scrub(v, key = '') {
  if (typeof v === 'string') return scrubString(key, v)
  if (Array.isArray(v)) return v.map((x) => scrub(x, key))
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, x] of Object.entries(v)) {
      const nk = teamPlaceholder.get(k) ?? (k === leagueId ? '<league>' : k)
      o[nk] = scrub(x, k)
    }
    return o
  }
  return v
}

const trimmedInfo = { ...info }
if (trimmedInfo.playerInfo && typeof trimmedInfo.playerInfo === 'object') {
  const entries = Object.entries(trimmedInfo.playerInfo)
  trimmedInfo.playerInfo = Object.fromEntries(entries.slice(0, 1))
}
const trimmedRosters = raw.getTeamRosters && typeof raw.getTeamRosters === 'object' ? { ...raw.getTeamRosters } : raw.getTeamRosters
if (trimmedRosters?.rosters) {
  trimmedRosters.rosters = Object.fromEntries(
    Object.entries(trimmedRosters.rosters).map(([id, r]) => [id, { ...r, rosterItems: Array.isArray(r?.rosterItems) ? r.rosterItems.slice(0, 2) : r?.rosterItems }]),
  )
}

const fixture = {
  provenance: {
    capturedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    source: `${baseUrl}/{getLeagueInfo,getTeamRosters,getStandings}?leagueId=<withheld>`,
    note: "One of the owner's own leagues, captured with the owner's consent by contracts/fantrax/scripts/probe.sh. No credentials (fxea/general is unauthenticated). League id and name, team ids and names replaced with placeholders; URL paths withheld (host and extension kept); playerInfo trimmed to 1 entry; rosterItems trimmed to 2 per team.",
    pictureKeys,
  },
  counts: {
    teams: teamIds.size,
    poolSize: info.playerInfo && typeof info.playerInfo === 'object' ? Object.keys(info.playerInfo).length : 0,
  },
  info: scrub(trimmedInfo),
  rosters: scrub(trimmedRosters),
  standings: scrub(standings.length ? standings : raw.getStandings),
}

const text = JSON.stringify(fixture, null, 2) + '\n'
const historyId = typeof info.leagueHistoryId === 'string' ? [info.leagueHistoryId] : []
const leaks = [leagueId, ...teamIds, ...nameOf.keys(), ...shortOf.keys(), ...historyId, ...(leagueName ? [leagueName] : [])].filter((s) => s && s.length > 2 && text.includes(s))
if (leaks.length) {
  console.error(`REFUSING to write: ${leaks.length} identifying value(s) survived redaction.`)
  process.exit(1)
}
fs.writeFileSync(out, text)
