#!/usr/bin/env node
/**
 * Trim a captured Fleaflicker fixture to a KEY-UNION COVER, and refuse to write one that loses a key.
 *
 * ENDPOINTS.yaml has described this trim since 2026-09-12 ("a minimal subset of array elements that
 * covers the full key union … the trimmer refuses to write a file that loses a key path") without
 * the trimmer ever being committed, so each capture re-derived it by hand. This is it.
 *
 * Why a cover and not "the first N elements": Fleaflicker OMITS a field rather than sending it
 * false or null (an empty lineup slot has no `leaguePlayer`; the bench group has no `group`), so
 * the first few elements routinely under-document the shape.
 *
 * Usage:
 *   node contracts/fleaflicker/scripts/trim-fixture.mjs <fixture.json> [--keep-all <key>]...
 *
 * `--keep-all groups` keeps EVERY element of any array stored under a key named `groups` (each
 * element's own nested arrays are still trimmed). Use it where the elements differ by VALUE, not by
 * keys — START / INJURED / TAXI all carry the same keys, and a key cover would keep only one.
 *
 * Rewrites the file in place (2-space indent, trailing newline, as probe.sh writes it) and prints
 * the key-path count before and after, which must be equal.
 */
import fs from 'node:fs'

const [file, ...rest] = process.argv.slice(2)
if (!file) {
  console.error('usage: trim-fixture.mjs <fixture.json> [--keep-all <key>]...')
  process.exit(2)
}
const keepAll = new Set()
for (let i = 0; i < rest.length; i++) if (rest[i] === '--keep-all' && rest[i + 1]) keepAll.add(rest[++i])

/** Every key path in `v`, array indices collapsed to `[]`. */
function paths(v, prefix = '', out = new Set()) {
  if (Array.isArray(v)) {
    out.add(`${prefix}[]`)
    for (const x of v) paths(x, `${prefix}[]`, out)
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const p = prefix ? `${prefix}.${k}` : k
      out.add(p)
      paths(x, p, out)
    }
  }
  return out
}

/** Greedy cover: the fewest elements whose own key paths (relative) cover the union of all of them. */
function cover(arr) {
  const sets = arr.map((x) => paths(x))
  const need = new Set(sets.flatMap((s) => [...s]))
  const chosen = []
  while (need.size > 0) {
    let best = -1
    let gain = 0
    sets.forEach((s, i) => {
      if (chosen.includes(i)) return
      let g = 0
      for (const p of s) if (need.has(p)) g++
      if (g > gain) {
        gain = g
        best = i
      }
    })
    if (best < 0) break
    chosen.push(best)
    for (const p of sets[best]) need.delete(p)
  }
  // Scalars (or elements with no keys) still need one representative.
  if (chosen.length === 0 && arr.length > 0) chosen.push(0)
  return chosen.sort((a, b) => a - b).map((i) => arr[i])
}

function trim(v, key = null) {
  if (Array.isArray(v)) {
    const kept = keepAll.has(key) ? v : cover(v)
    return kept.map((x) => trim(x))
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, k)]))
  return v
}

const original = JSON.parse(fs.readFileSync(file, 'utf8'))
const trimmed = trim(original)
const before = paths(original)
const after = paths(trimmed)
const lost = [...before].filter((p) => !after.has(p))
if (lost.length > 0) {
  console.error(`REFUSING: the trim would lose ${lost.length} key path(s):`)
  for (const p of lost.slice(0, 20)) console.error(`  ${p}`)
  process.exit(1)
}
fs.writeFileSync(file, JSON.stringify(trimmed, null, 2) + '\n')
console.log(`key paths: ${before.size} before, ${after.size} after — zero lost`)
console.log(`bytes: ${Buffer.byteLength(JSON.stringify(original, null, 2))} -> ${fs.statSync(file).size}`)
