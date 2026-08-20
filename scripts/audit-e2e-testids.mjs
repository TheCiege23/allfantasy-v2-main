#!/usr/bin/env node
/**
 * Find Playwright specs that click testids the app does not render.
 *
 * WHY THIS EXISTS
 * The core Playwright shards are red tree-wide, and on a sampled run 44 of 51
 * failures were `element(s) not found` — not timeouts, not a sick server. That is
 * a spec asking for UI that is not there, and it is invisible until someone reads
 * a CI log line by line.
 *
 * The first pass at this was done by hand with grep and was WRONG THREE TIMES,
 * which is the whole reason it is a script now:
 *
 *   1. A literal search reported 38 of 166 ids missing. Most were fine —
 *      `draft-board-cell-1` and `af-plan-diff-af-pro` are built from templates at
 *      runtime, so the literal never appears in the source.
 *   2. Allowing any hyphen prefix then went too far: `draft-` matches half the
 *      codebase, so three ids that really were absent came back "present".
 *   3. Requiring a stem of six characters did not help either — `draft-` is
 *      exactly six.
 *
 * So a stem only counts when the app demonstrably CONCATENATES onto it
 * (`` `stem${...}` `` or `'stem' + ...`) AND the stem carries at least two
 * hyphens. That combination classifies every hand-checked case correctly.
 *
 * ⚠ THE VALIDATION SET BELOW IS THE POINT. It pins ten ids that were verified by
 * reading the source — five present, five absent — and the audit REFUSES to print
 * results if it gets any of them wrong. Without it this script is just a
 * confident-sounding grep, and a confident-sounding grep is what produced the
 * three wrong answers above.
 *
 *   node scripts/audit-e2e-testids.mjs
 *   node scripts/audit-e2e-testids.mjs --list   # every absent id, not just a summary
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const LIST = process.argv.includes('--list')

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.next')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p)
  }
  return out
}

const appFiles = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))]
const blob = appFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')

// Positive control. "No matches" is untrustworthy on this repo, so prove the
// corpus is readable before drawing any conclusion from an absence.
if (!blob.includes('data-testid')) {
  console.error('POSITIVE CONTROL FAILED: no data-testid anywhere in app/ or components/.')
  console.error('The corpus did not load; every result would be a false "absent".')
  process.exit(2)
}

/** Stems the app concatenates onto, e.g. `draft-board-cell-${i}`. */
const stems = new Set()
for (const m of blob.matchAll(/`([a-zA-Z0-9_-]{4,})\$\{/g)) stems.add(m[1])
for (const m of blob.matchAll(/["']([a-zA-Z0-9_-]{4,})["']\s*\+/g)) stems.add(m[1])

const appHas = (tid) =>
  blob.includes(tid) ||
  [...stems].some((s) => tid.startsWith(s) && (s.match(/-/g) ?? []).length >= 2)

// ---- validation ------------------------------------------------------------
const PRESENT = [
  'discovery-format-bracket',
  'content-feed-article-link-blog_soccer_1',
  'draft-board-cell-1',
  'af-plan-diff-af-pro',
  'draft-commissioner-modal',
]
const ABSENT = [
  'dashboard-global-empty-state',
  'draft-selected-player-panel',
  'referral-share-twitter',
  'trade-ai-explanation-link',
  'draft-open-commissioner-controls',
]
const wrong = [
  ...PRESENT.filter((t) => !appHas(t)).map((t) => `said ABSENT, is present: ${t}`),
  ...ABSENT.filter((t) => appHas(t)).map((t) => `said PRESENT, is absent: ${t}`),
]
if (wrong.length > 0) {
  console.error('VALIDATION FAILED — results withheld:\n')
  for (const w of wrong) console.error('  ' + w)
  console.error(
    '\nEither the matching rule regressed, or one of these ids changed in the app.\n' +
      'Re-check by hand and update the set. Do NOT relax the rule to make this pass.',
  )
  process.exit(1)
}
console.log(`validation: ${PRESENT.length + ABSENT.length}/${PRESENT.length + ABSENT.length} hand-checked ids correct`)

// ---- audit -----------------------------------------------------------------
const e2eDir = path.join(ROOT, 'e2e')
const refs = new Map() // testid -> Set<spec>
for (const fn of fs.readdirSync(e2eDir)) {
  if (!fn.endsWith('.spec.ts')) continue
  const src = fs.readFileSync(path.join(e2eDir, fn), 'utf8')
  for (const m of src.matchAll(/getByTestId\(\s*["']([^"']+)["']/g)) {
    if (!refs.has(m[1])) refs.set(m[1], new Set())
    refs.get(m[1]).add(fn)
  }
}

const missing = [...refs.entries()].filter(([tid]) => !appHas(tid))
console.log(`\nspec testids referenced : ${refs.size}`)
console.log(`absent from the app     : ${missing.length}`)

const perSpec = new Map()
for (const [tid, specs] of missing) {
  for (const s of specs) {
    if (!perSpec.has(s)) perSpec.set(s, [])
    perSpec.get(s).push(tid)
  }
}

console.log('\nspecs asking for UI that does not exist:')
for (const [spec, ids] of [...perSpec.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${spec.padEnd(52)} ${String(ids.length).padStart(2)}`)
  if (LIST) for (const id of ids.sort()) console.log(`        ${id}`)
}

console.log(
  '\nAn absent testid is not automatically a spec bug — the UI may have been removed\n' +
    'deliberately, in which case the assertion should go too. Read the component before\n' +
    'deciding which side is wrong.',
)
