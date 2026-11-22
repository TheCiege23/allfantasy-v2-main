#!/usr/bin/env node
/**
 * Redact an ESPN fantasy capture IN PLACE before it can be committed. Called by probe.sh for the
 * fantasy endpoints; makes no request itself.
 *
 *   node redact-fantasy.mjs <fixture.json> <leagueId>
 *
 * This repo is public. A fantasy league capture carries people: member display/first/last names,
 * their ESPN member ids (SWIDs, which also appear inside rosters, transactions, draft picks and
 * the activity feed), team names, nicknames, abbreviations and custom logos, and — in the activity
 * feed — free-text chat. All of it is replaced with synthetic values that keep the SHAPE (same
 * keys, same types, ids still consistent across the document), so a parser tested against the
 * fixture sees what it would see live.
 *
 * Player names, NFL teams, stats and settings are public sports data and are kept.
 *
 * Refuses to write when any original member id, member name, team name or the league id is still
 * present anywhere in the output — the positive check that the redaction actually covered it.
 */
import fs from 'node:fs'

const [file, leagueId] = process.argv.slice(2)
if (!file || !leagueId) {
  console.error('usage: redact-fantasy.mjs <fixture.json> <leagueId>')
  process.exit(2)
}

const raw = fs.readFileSync(file, 'utf8')
const body = JSON.parse(raw)

/* ── collect what identifies people ───────────────────────────────────────────────────────── */
const memberIdMap = new Map() // original id -> fixture-manager-N
const secrets = new Set([String(leagueId)])
const members = Array.isArray(body.members) ? body.members : []
members.forEach((m, i) => {
  const n = i + 1
  if (m && typeof m === 'object') {
    if (m.id) memberIdMap.set(String(m.id), `fixture-manager-${n}`)
    for (const k of ['displayName', 'firstName', 'lastName']) {
      if (typeof m[k] === 'string' && m[k].trim().length >= 3) secrets.add(m[k].trim())
    }
  }
})

// Ids that look like ESPN SWIDs anywhere in the document, even ones not listed in members
// (a former member still named on an old transaction).
const SWID = /\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g
for (const match of raw.match(SWID) ?? []) {
  if (!memberIdMap.has(match)) memberIdMap.set(match, `fixture-manager-${memberIdMap.size + 1}`)
}
for (const id of memberIdMap.keys()) secrets.add(id)

const teams = Array.isArray(body.teams) ? body.teams : []
for (const t of teams) {
  for (const k of ['name', 'location', 'nickname']) {
    if (t && typeof t[k] === 'string' && t[k].trim().length >= 4) secrets.add(t[k].trim())
  }
}
const leagueName = body?.settings?.name
if (typeof leagueName === 'string' && leagueName.trim().length >= 4) secrets.add(leagueName.trim())

/* ── rewrite ──────────────────────────────────────────────────────────────────────────────── */
function remapString(s) {
  let out = s
  for (const [from, to] of memberIdMap) if (out.includes(from)) out = out.split(from).join(to)
  return out
}

let chatRedacted = 0
function walk(v, key) {
  if (Array.isArray(v)) return v.map((x) => walk(x, key))
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, x] of Object.entries(v)) o[k] = walk(x, k)
    return o
  }
  if (typeof v === 'string') return remapString(v)
  return v
}

const out = walk(body)

members.forEach((_, i) => {
  const m = out.members[i]
  if (!m || typeof m !== 'object') return
  const n = i + 1
  if ('displayName' in m) m.displayName = `Fixture Manager ${n}`
  if ('firstName' in m) m.firstName = 'Fixture'
  if ('lastName' in m) m.lastName = String(n)
})
;(out.teams ?? []).forEach((t) => {
  if (!t || typeof t !== 'object') return
  const n = t.id ?? '?'
  if ('name' in t) t.name = `Fixture Team ${n}`
  if ('location' in t) t.location = 'Fixture'
  if ('nickname' in t) t.nickname = `Team ${n}`
  if ('abbrev' in t) t.abbrev = `T${n}`
  if ('logo' in t) t.logo = 'https://example.invalid/fixture-logo.png'
})
if (out.settings && typeof out.settings === 'object' && 'name' in out.settings) out.settings.name = 'Fixture League'
if ('id' in out && String(out.id) === String(leagueId)) out.id = 123456

// Activity feed: free text written by people. Keep every structural field; replace the words.
function redactMessages(node) {
  if (Array.isArray(node)) return node.forEach(redactMessages)
  if (!node || typeof node !== 'object') return
  for (const k of ['message', 'text', 'title', 'body']) {
    if (typeof node[k] === 'string' && node[k].length > 0) {
      node[k] = '[redacted chat text]'
      chatRedacted++
    }
  }
  for (const v of Object.values(node)) redactMessages(v)
}
if (Array.isArray(out.topics)) redactMessages(out.topics)

/* ── verify ───────────────────────────────────────────────────────────────────────────────── */
const text = `${JSON.stringify(out, null, 2)}\n`
const leaks = [...secrets].filter((s) => text.includes(s))
if (leaks.length > 0) {
  console.error(`REFUSING TO WRITE: ${leaks.length} identifying value(s) survived redaction.`)
  process.exit(1)
}
if ((text.match(SWID) ?? []).length > 0) {
  console.error('REFUSING TO WRITE: an ESPN member id (SWID) survived redaction.')
  process.exit(1)
}

fs.writeFileSync(file, text)
console.error(
  `redacted: ${memberIdMap.size} member id(s), ${members.length} member name(s), ${teams.length} team(s), ` +
    `${chatRedacted} free-text field(s); ${secrets.size} value(s) verified absent.`,
)
