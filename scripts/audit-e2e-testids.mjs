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
 *
 * ⚠ THE LIST IS NOT A BUG QUEUE. EVERY ENTRY ON IT WAS RUN, AND NONE OF THEM
 * CAUSED A FAILURE. Measured 2026-08-20, once the count
 * came down from 68. Three distinct reasons an entry can be here and be fine:
 *
 *   1. THE SPEC ASSERTS THE ID IS ABSENT.
 *      draft-room-click-audit:1786 does `toHaveCount(0)` on
 *      draft-open-commissioner-controls, and its one click on that id (:1706) is
 *      wrapped in `.catch(() => null)`. An absent id there is the assertion
 *      PASSING. draft-room is 8/8 green.
 *
 *   2. THE ASSERTION IS INSIDE A GUARD THAT DOES NOT RUN.
 *      draft-selected-player-panel is asserted visible at :1533 and :1535, both
 *      inside `if (await helperRefresh.isVisible().catch(() => false))`. The
 *      branch is skipped, so the id is never looked for.
 *
 *   3. THE SPEC FAILS ON A DIFFERENT, UNFLAGGED ID.
 *      draft-asset-pipeline dies on draft-player-card-0 -- composed at
 *      PlayerPanel.tsx:290 from a virtualiser row index, so this file correctly
 *      reports it present. ai-system-final-integration dies on
 *      waiver-ai-help-link, which IS rendered (WaiverWirePage.tsx:1468) but not
 *      by /e2e/waiver-wire-live, whose harness mounts SportAwareWaiverWire with
 *      a league id that has no data. Both are harness/fixture problems, not
 *      missing test hooks, and no amount of testid analysis will find them.
 *
 * So: read an entry as "worth one run", never as "a bug". The run is cheap and it
 * has disagreed with this list more often than it has agreed.
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

/*
 * pages/ IS PART OF THE APP AND MUST BE IN THE CORPUS.
 *
 * The first version walked only app/ and components/, so every id rendered by
 * the legacy Pages Router read as absent -- 19 of the 54 ids it reported. The
 * specs asserting them PASS, which is how it was caught: g39 and g40 drive
 * pages/e2e-g39-nfl-redraft-trade-runtime.tsx and its g40 sibling, wait on the
 * harness being visible, and go green while the audit called their ids missing.
 *
 * tsconfig.json already compiles the pages tsx glob. A corpus that
 * disagrees with the compiler about where the app lives will invent absences.
 */
const appFiles = [
  ...walk(path.join(ROOT, 'app')),
  ...walk(path.join(ROOT, 'components')),
  ...walk(path.join(ROOT, 'pages')),
]
const blob = appFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')

// Positive control. "No matches" is untrustworthy on this repo, so prove the
// corpus is readable before drawing any conclusion from an absence.
if (!blob.includes('data-testid')) {
  console.error('POSITIVE CONTROL FAILED: no data-testid anywhere in app/, components/ or pages/.')
  console.error('The corpus did not load; every result would be a false "absent".')
  process.exit(2)
}
// Per-root control: a silently-empty root is indistinguishable from "the app
// does not render that id", which is the exact failure this file exists to avoid.
for (const root of ['app', 'components', 'pages']) {
  if (!appFiles.some((f) => f.includes(path.sep + root + path.sep))) {
    console.error(`POSITIVE CONTROL FAILED: no files walked under ${root}/.`)
    process.exit(2)
  }
}

/** Stems the app concatenates onto, e.g. `draft-board-cell-${i}`. */
const stems = new Set()
for (const m of blob.matchAll(/`([a-zA-Z0-9_-]{4,})\$\{/g)) stems.add(m[1])
for (const m of blob.matchAll(/["']([a-zA-Z0-9_-]{4,})["']\s*\+/g)) stems.add(m[1])

/*
 * Prefixes the app declares as a PROP, then concatenates onto in the child.
 *
 * This is the composition style the stem rule above cannot see. The literal
 * never sits next to a `${`, because the two halves live in different files:
 *
 *   <ReferralShareBar testIdPrefix="referral-share" />        // components/settings
 *   data-testid={`${testIdPrefix}-${key}`}                    // components/referral
 *
 * A declared testIdPrefix is authoritative, so unlike the inferred stems above
 * these need no hyphen-count guard -- they are not a guess about what might be a
 * stem, they are the app saying so. The id must still start with `prefix-`.
 *
 * 18 of the ids this audit reported were this class, including all seven in
 * viral-league-invite, whose two tests pass.
 */
const prefixStems = new Set()
for (const m of blob.matchAll(/testIdPrefix\s*[=:]\s*["']([a-zA-Z0-9_-]+)["']/g)) prefixStems.add(m[1])

const appHas = (tid) =>
  blob.includes(tid) ||
  [...stems].some((s) => tid.startsWith(s) && (s.match(/-/g) ?? []).length >= 2) ||
  [...prefixStems].some((p) => tid.startsWith(p + '-'))

// ---- validation ------------------------------------------------------------
const PRESENT = [
  // Corrected: this was pinned ABSENT. components/referral/ReferralShareBar.tsx
  // lists { key: 'twitter' } in CHANNELS and renders `${testIdPrefix}-${key}`,
  // with ReferralSection passing testIdPrefix="referral-share". Settled by
  // running it: referral-system-click-audit clicks this id and passes.
  'referral-share-twitter',
  'discovery-format-bracket',
  'content-feed-article-link-blog_soccer_1',
  'draft-board-cell-1',
  'af-plan-diff-af-pro',
  'draft-commissioner-modal',
]
const ABSENT = [
  'dashboard-global-empty-state',
  'draft-selected-player-panel',
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

// ---- skipped regions --------------------------------------------------------
/*
 * An id referenced only from a skipped test is NOT outstanding work -- that file
 * has already been triaged and the assertion never runs. Counting them made the
 * first version of this report overstate the backlog by 24%: of 68 absent ids, 9
 * sat inside token-system's `test.describe.skip` (retired deliberately, with the
 * reasoning written into the file) and 7 more belonged to a spec that PASSES.
 * Someone working the list top-down would have opened a file whose verdict was
 * already recorded in a comment directly above the tests.
 *
 * Skipped ids are reported SEPARATELY rather than dropped. Dropping them would
 * hide a real signal: if a skipped spec's ids reappear in the app, that is the
 * cue to unskip it.
 */
const NL = String.fromCharCode(10)
const EOL = NL
const BACKSLASH = String.fromCharCode(92)
const SKIP_CALL = /\b(?:test|it|describe)(?:\.describe)?\.skip\s*\(/g

function skippedRanges(src) {
  const ranges = []
  for (const m of src.matchAll(SKIP_CALL)) {
    /*
     * The body is the block after the ARROW, not the first brace found.
     * `test.skip('name', async ({ page }) => {` opens and closes a brace in its
     * destructured parameter first, so taking brace #1 as the body produced a
     * range one line long -- which silently reported 57 already-skipped ids in
     * admin-dashboard-click-audit as outstanding work. Both pins below exist
     * because of that bug.
     */
    let quote = null
    let lineComment = false
    let blockComment = false
    let arrow = -1
    for (let i = m.index; i < src.length && arrow < 0; i++) {
      const c = src[i]
      const n = src[i + 1]
      if (lineComment) { if (c === NL) lineComment = false; continue }
      if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++ } continue }
      if (quote) {
        if (c === BACKSLASH) i++
        else if (c === quote) quote = null
        continue
      }
      if (c === '/' && n === '/') { lineComment = true; i++; continue }
      if (c === '/' && n === '*') { blockComment = true; i++; continue }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '=' && n === '>') arrow = i + 1
    }
    if (arrow < 0) continue

    let depth = 0
    let body = -1
    quote = null
    lineComment = false
    blockComment = false
    for (let i = arrow; i < src.length; i++) {
      const c = src[i]
      const n = src[i + 1]
      if (lineComment) { if (c === NL) lineComment = false; continue }
      if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++ } continue }
      if (quote) {
        if (c === BACKSLASH) i++
        else if (c === quote) quote = null
        continue
      }
      if (c === '/' && n === '/') { lineComment = true; i++; continue }
      if (c === '/' && n === '*') { blockComment = true; i++; continue }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '{') {
        depth++
        if (body < 0) body = i
      } else if (c === '}') {
        depth--
        if (body >= 0 && depth === 0) { ranges.push([m.index, i]); break }
      }
    }
  }
  return ranges
}
const inRanges = (ranges, i) => ranges.some(([a, b]) => i >= a && i <= b)

// ---- audit -----------------------------------------------------------------
const e2eDir = path.join(ROOT, 'e2e')
const TESTID = /getByTestId\(\s*["']([^"']+)["']/g
const refs = new Map() // testid -> Set<spec>
const skippedOnly = new Map() // testid -> Set<spec>, seen ONLY inside skipped tests
for (const fn of fs.readdirSync(e2eDir)) {
  if (!fn.endsWith('.spec.ts')) continue
  const src = fs.readFileSync(path.join(e2eDir, fn), 'utf8')
  const skipped = skippedRanges(src)
  for (const m of src.matchAll(TESTID)) {
    const target = inRanges(skipped, m.index) ? skippedOnly : refs
    if (!target.has(m[1])) target.set(m[1], new Set())
    target.get(m[1]).add(fn)
  }
}
// An id asserted in BOTH a live and a skipped test is live work, not skipped.
for (const tid of refs.keys()) skippedOnly.delete(tid)

// Pin, in the same spirit as the validation set above: token-system is entirely
// `test.describe.skip`, so none of its ids may be reported as outstanding.
const PINS = [
  'tokens-pricing-clear-filters', // token-system: the whole describe is skipped
  'admin-overview-refresh', // admin-dashboard: inside a test.skip, past the ({ page }) braces
]
for (const PIN of PINS) if (refs.has(PIN) || !skippedOnly.has(PIN)) {
  console.error(
    `skip detection is wrong: ${PIN} sits inside token-system's test.describe.skip,` +
      ' so it must classify as skipped, not as outstanding.',
  )
  process.exit(1)
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

const missingSkipped = [...skippedOnly.entries()].filter(([tid]) => !appHas(tid))
if (missingSkipped.length) {
  const bySpec = new Map()
  for (const [tid, specs] of missingSkipped)
    for (const sp of specs) bySpec.set(sp, [...(bySpec.get(sp) || []), tid])
  console.log(EOL + `already skipped, not outstanding : ${missingSkipped.length}`)
  for (const [spec, ids] of [...bySpec.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${spec.padEnd(52)} ${String(ids.length).padStart(2)}`)
    if (LIST) for (const id of ids.sort()) console.log(`        ${id}`)
  }
  console.log('  ^ these tests do not run. Read the comment above them before touching.')
}

console.log(
  '\nAn absent testid is not automatically a spec bug — the UI may have been removed\n' +
    'deliberately, in which case the assertion should go too. Read the component before\n' +
    'deciding which side is wrong.',
)
