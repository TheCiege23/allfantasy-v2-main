#!/usr/bin/env node
/**
 * Asserts that `vercel.json` still gates builds to the production branch.
 *
 * WHY THIS EXISTS. Builds are the entire Vercel bill on this project: the
 * invoice paid 2026-08-27 was $101.40, of which $100.90 was one line — Build CPU
 * Minutes, qty 34,338. Storage and transfer together were $0.50. The driver was
 * volume, not size: ~39 pushes a day to main (544 in 14 days) plus 279 branches
 * pushed in one billing period, each one a preview build of a 1,528-route app.
 *
 * `vercel.json` was `{}` until 979ae7cf4 added the gate. Restoring `{}` restores
 * the burn — and NOTHING FAILS WHEN IT HAPPENS. That is the whole problem this
 * check solves: the gate's absence is invisible at runtime, so the only signal
 * is a bill four weeks later.
 *
 * ⚠ IT IS EASY TO REVERT BY ACCIDENT, NOT BY MALICE. Every worktree branched
 * before 979ae7cf4 still has `{}` on disk. Committing that working-tree copy to
 * main silently undoes the gate. Two protections were removed exactly that way
 * on 2026-08-27 alone — this one, and an AI-spend guard that went out together
 * with its own coverage test (unguarded code, green suite). Reviewing diffs more
 * carefully is not a mechanism. This is.
 *
 * 🛑 THE POLARITY IS INVERTED AND THAT IS NOT A BUG. Vercel's `ignoreCommand`
 * treats exit 1 as BUILD and exit 0 as SKIP. So the production branch must exit
 * 1 and everything else must exit 0. Anyone "fixing" that to read naturally
 * would skip production and build every branch — the exact opposite, and more
 * expensive than having no gate at all. The polarity is asserted below, not just
 * the presence of the key.
 *
 * Dependency-free by design (Node stdlib only), matching cron-budget-check.mjs:
 * it means CI needs no `npm ci` to run it.
 */

import fs from 'node:fs'
import path from 'node:path'

const FILE = path.join(process.cwd(), 'vercel.json')
const failures = []

function fail(what, detail) {
  failures.push(`${what}\n      ${detail}`)
}

let raw
try {
  raw = fs.readFileSync(FILE, 'utf8')
} catch {
  console.error('vercel-build-gate: cannot read vercel.json at repo root.')
  process.exit(1)
}

let config
try {
  config = JSON.parse(raw)
} catch (e) {
  console.error(`vercel-build-gate: vercel.json is not valid JSON — ${e.message}`)
  process.exit(1)
}

// ── 1. the gate exists ────────────────────────────────────────────────────────
const ignoreCommand = typeof config.ignoreCommand === 'string' ? config.ignoreCommand : ''

if (!ignoreCommand.trim()) {
  fail(
    'vercel.json has no `ignoreCommand`.',
    'Every pushed branch builds. This is the `{}` state that cost $100.90 in one billing period.',
  )
} else {
  // ── 2. it gates on the branch, not on something incidental ──────────────────
  if (!ignoreCommand.includes('VERCEL_GIT_COMMIT_REF')) {
    fail(
      '`ignoreCommand` does not reference VERCEL_GIT_COMMIT_REF.',
      'Whatever it checks, it is not the branch, so preview branches are not gated.',
    )
  }
  if (!/\bmain\b/.test(ignoreCommand)) {
    fail(
      '`ignoreCommand` never mentions the production branch `main`.',
      'A gate that does not name the branch it protects cannot be protecting it.',
    )
  }

  /*
   * ── 3. POLARITY. exit 1 = build, exit 0 = skip.
   *
   * Split on the first `else`: the production side must BUILD (exit 1) and the
   * fallthrough must SKIP (exit 0). Checking only that both codes appear would
   * pass a command with them swapped, which is the costly failure.
   */
  const [productionSide, otherSide] = ignoreCommand.split(/\belse\b/, 2)

  if (otherSide === undefined) {
    fail(
      '`ignoreCommand` has no `else` branch.',
      'Cannot tell production from preview, so the polarity is unverifiable.',
    )
  } else {
    if (!/exit\s+1/.test(productionSide)) {
      fail(
        'The production branch of `ignoreCommand` does not `exit 1`.',
        'Vercel reads exit 0 as SKIP, so main would stop deploying. exit 1 means BUILD.',
      )
    }
    if (!/exit\s+0/.test(otherSide)) {
      fail(
        'The non-production branch of `ignoreCommand` does not `exit 0`.',
        'Vercel reads exit 1 as BUILD, so every preview branch would build again.',
      )
    }
  }
}

// ── 4. dev deployments stay off ───────────────────────────────────────────────
if (config?.git?.deploymentEnabled?.dev !== false) {
  fail(
    '`git.deploymentEnabled.dev` is not false.',
    'The `dev` branch would deploy on every push, which is what this key turns off.',
  )
}

if (failures.length > 0) {
  console.error('\nvercel-build-gate: FAILED — the build gate is not intact.\n')
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}\n`))
  console.error(
    '  Builds are ~100% of this project\'s Vercel bill. If you meant to change the gate,\n' +
      '  update this check in the same commit and say why. If you did NOT mean to touch\n' +
      '  vercel.json — the usual cause — your worktree predates 979ae7cf4 and still has the\n' +
      '  old `{}` on disk. Rebuild it from origin/main rather than committing your copy:\n\n' +
      '      git show origin/main:vercel.json > vercel.json\n',
  )
  process.exit(1)
}

console.log('vercel-build-gate OK — non-production branches skip the build, main still deploys.')
