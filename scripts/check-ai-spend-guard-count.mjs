#!/usr/bin/env node
/**
 * Floor on how many provider boundaries are wired to the AI spend guard.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE TEST. `__tests__/ai/ai-spend-guard.test.ts`
 * already asserts that each file in its `GUARDED` list calls the guard, keeps a
 * ratchet of known-unguarded boundaries, and runs a census. It is good, and it
 * still let a real regression through on 2026-08-27:
 *
 *   16ae895fb  added the guard to lib/ai-gm-intelligence.ts
 *   2c959164c  removed the guard AND deleted that file's GUARDED entry —
 *              in the SAME commit, alongside an unrelated draft-hq feature
 *   e5e173acf  restored it, hours later
 *
 * With the entry gone there was nothing left to assert, so the suite stayed
 * green over an unguarded OpenAI client. A list-driven check cannot catch its
 * own list shrinking.
 *
 * So this counts the guard across the tree instead of enumerating paths. It
 * shares no data with the test: trimming the test's list does not lower this
 * number, and lowering this number requires actually removing a guard call.
 *
 * ⚠ NOT A CENSUS AND NOT A CEILING. It cannot tell you that every boundary is
 * guarded — the test's census does that. It only catches the count going DOWN,
 * which is the specific failure that shipped. Adding a guard raises the floor;
 * raise MINIMUM in the same commit.
 *
 * Dependency-free (Node stdlib), so CI needs no `npm ci`.
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Both forms count. The choice is forced by each boundary's own contract, not by
 * preference: `assertAiSpendAllowed` throws and suits a factory that already
 * throws without a key; `isAiSpendEnabled` returns false and suits one that
 * returns null or a degraded value. Requiring a single form would push callers
 * to turn graceful fallbacks into 500s.
 */
const GUARD_CALL = /\b(assertAiSpendAllowed|isAiSpendEnabled)\s*\(/

/**
 * Measured on origin/main 2026-08-28: 37 files. Raise this when you guard a new
 * boundary; never lower it without saying which boundary stopped spending money.
 *
 * ⚠ 37, NOT the 33 in the test's GUARDED list. Four boundaries are guarded but
 * not enumerated there — `lib/serper.ts`,
 * `lib/autocoach/status-sources/GoogleSearchAdapter.ts`, and the two legacy
 * `server/api-route-modules/` routes. Setting the floor to the test's number
 * would leave those four removable without a single check failing, which is the
 * whole failure mode this file exists to close. The floor tracks what is
 * MEASURED, never what another list happens to say.
 */
const MINIMUM = 37

const ROOTS = ['lib', 'app', 'server', 'components']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '__tests__', '.git'])
/** The guard's own module defines these; counting it would inflate the floor by one. */
const DEFINITION = path.join('lib', 'ai', 'aiSpendGuard.ts')

const found = []

function walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (entry.name.endsWith('.d.ts')) continue
    const rel = path.relative(process.cwd(), full)
    if (rel === DEFINITION || rel.split(path.sep).join('/') === 'lib/ai/aiSpendGuard.ts') continue
    let text
    try {
      text = fs.readFileSync(full, 'utf8')
    } catch {
      continue
    }
    if (GUARD_CALL.test(text)) found.push(rel.split(path.sep).join('/'))
  }
}

for (const root of ROOTS) walk(path.join(process.cwd(), root))
found.sort()

if (found.length < MINIMUM) {
  console.error(
    `\nai-spend-guard-count: FAILED — ${found.length} guarded boundaries, expected at least ${MINIMUM}.\n`,
  )
  console.error(
    '  A provider boundary stopped calling the AI spend guard. That code now spends money\n' +
      '  regardless of the switch, and NOTHING ELSE FAILS when it happens — this exact\n' +
      '  regression shipped on 2026-08-27 (2c959164c) and stayed green because the guard and\n' +
      '  its own test entry were removed in the same commit.\n\n' +
      '  Find it with:  git diff origin/main -- lib app server components | grep -nE "^-.*(assertAiSpendAllowed|isAiSpendEnabled)"\n\n' +
      '  If a boundary was DELETED rather than unguarded, lower MINIMUM in this file and say\n' +
      '  which one, so the next reader can tell a deletion from a silent revert.\n',
  )
  console.error(`  Currently guarded (${found.length}):`)
  found.forEach((f) => console.error(`    ${f}`))
  process.exit(1)
}

console.log(
  `ai-spend-guard-count OK — ${found.length} provider boundaries wired to the spend guard ` +
    `(floor ${MINIMUM}).`,
)
