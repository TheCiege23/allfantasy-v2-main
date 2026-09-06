#!/usr/bin/env node
/**
 * Automated replacement for the batch-pusher's manual cross-session smoke check.
 *
 * WHY THIS EXISTS
 *
 * 🛑 THE BATCHING CONVENTION AND THE PUSHER ROLE STAND. An earlier draft of
 * this header said they had been "retired as a default now that production
 * bills like Railway usage" and pointed at a dated CLAUDE.md section for the
 * numbers. That was wrong on both counts: the section was an UNCOMMITTED
 * working-tree edit that never reached `main`, and Guap reaffirmed the role
 * and the batching rule on 2026-09-06 when asked directly. Corrected before
 * landing, because a comment asserting a policy outlives the conversation
 * that produced it and the next reader has no way to tell a real decision
 * from a confident paraphrase.
 *
 * So this is a FLOOR UNDER the pusher, not a replacement for one. What it
 * automates is the one check an author structurally cannot run for
 * themselves: a typecheck of the exact SHA being pushed, against that
 * commit's own baseline. That is what caught the `LivePageData.fetchedAt`
 * type widening documented in CLAUDE.md — a check scoped to "my files" would
 * have missed it, because the break showed up in a CONSUMER's file.
 *
 * ⚠ AND IT CLOSES A GAP THE MANUAL PAIR COULD NOT. Handovers in this repo
 * routinely arrive saying "NO REPO TYPECHECK, AND I AM NOT CLAIMING ONE",
 * because a full manual pair needs a clear box and this machine runs ~9
 * sessions. On 2026-09-06 the pusher spent two hours failing to get one: three
 * concurrent tsc runs at 0.2 GB free, a pair abandoned when two of its own
 * stopped background tasks orphaned and checked out a different ref in the
 * worktree mid-run. This guard ran the same measurement in 600s without
 * needing a window, because it skips under load rather than competing for it.
 * The saturation problem and the attestation gap were the same problem.
 *
 * WHY AN ISOLATED WORKTREE, NOT THE PUSHING SESSION'S OWN CHECKOUT
 * CLAUDE.md's git section has a whole entry on a check that passes against an
 * artifact nobody shipped: a shared checkout can hold a peer's uncommitted
 * edits, so a typecheck run in place describes the WORKING TREE, not the
 * commit being pushed. This builds the pushed SHA itself, from a git object,
 * in a location nothing else writes to.
 *
 * FAIL-OPEN VS FAIL-CLOSED, DELIBERATELY DIFFERENT FROM THE OTHER TWO GUARDS
 * push-queue.mjs and check-inflight-prod-build.mjs fail open on every error,
 * because their job is cost and ordering — stranding a deploy is worse than
 * the money. This guard's job is correctness, so a POSITIVE, PARSED regression
 * fails CLOSED (blocks the push) — that is the entire point of adding it.
 * Everything else (could not create the worktree, tsc did not run, the ratchet
 * itself errored) still fails OPEN with a loud warning: an uncertain check is
 * not evidence of a regression, and this guard must not become a new single
 * point of failure that blocks every push in the room.
 *
 * ⚠ EXIT CODE 1 IS AMBIGUOUS IN THE UNDERLYING TOOLS AND MUST NOT BE TRUSTED
 * ALONE. `ts-error-ratchet.mjs` exits 1 both for a genuine regression AND for
 * an uncaught throw from a tsc launch failure (no try/catch around `main()`,
 * so a thrown Error becomes an uncaught-exception exit 1 with a stack trace).
 * Exit code alone cannot tell those apart, so this classifies by the tool's
 * OWN text: "gained TypeScript errors" is the regression path, anything else
 * on a non-zero exit is treated as a broken run. Same reasoning applies to
 * `vitest-ratchet.mjs`'s "were passing and now FAIL" vs its own
 * "infrastructure failure" message.
 *
 * ⚠ A REUSED DETACHED WORKTREE LIES IF TSC'S INCREMENTAL CACHE SURVIVES A
 * CHECKOUT SWAP. This repo's tsconfig sets `incremental: true`, and reusing
 * one worktree path across many different SHAs is exactly the shape that
 * bites: a stale `.tsbuildinfo` from a PREVIOUS sha can make tsc trust cached
 * state instead of re-analysing the new one. Every run deletes any
 * `*.tsbuildinfo` in the worktree root before invoking the ratchet.
 *
 * WHAT THIS DOES NOT DO
 * - It does not run the full vitest suite by default (AF_SMOKE_RUN_TESTS=1
 *   turns it on). CLAUDE.md records that vitest has never gated a merge in
 *   this repo and the full suite takes meaningfully longer than the typecheck
 *   — silently defaulting that on would slow every push more than today's
 *   evidence justifies. Revisit once someone has timed a full run properly.
 * - It does not replace a human reading a genuinely large or risky diff. Claim
 *   the pusher role for that on purpose; this guard is the floor, not the
 *   ceiling.
 * - It checks machine load before running (see `tooBusy()` below) but only
 *   as a coarse process count, not memory headroom — CLAUDE.md documents
 *   concurrent tsc runs killing each other under memory pressure on this box,
 *   and this guard adding its OWN tsc invocation to every push is exactly the
 *   shape that makes that worse under the new decentralized model, where many
 *   sessions can push (and therefore smoke-check) around the same time. This
 *   was not a hypothetical while writing it: a live check during development
 *   found two other `tsc.js` processes already running at 6+GB working set
 *   each. Skipping under load is a deliberate fail-open, same as everything
 *   else in this file — a missed check is better than contributing to a pile
 *   that kills several sessions' runs at once, and it is ALSO better than
 *   pretending the check ran when it may have been slowed into meaninglessness.
 *
 * Escape hatch, for a genuine emergency only: AF_SKIP_SMOKE_CHECK=1 git push …
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'

const ZEROS = /^0+$/

/**
 * APPROXIMATE, and deliberately marked as such rather than trusted — same
 * caveat `check-inflight-prod-build.mjs` carries on `TYPICAL_BUILD_MIN`. This
 * clears the incremental cache before every run (see the header comment on
 * why), so every run is a COLD full-repo compile, and this repo is large
 * enough (12,500+ files) that a cold compile is not fast even uncontended.
 * Measured 2026-09-06 on a contended box (2 other tsc.js processes already
 * running, 5-6GB each): still running past 15 minutes. A 6-minute default —
 * the first value tried — timed out on effectively every real run, which is
 * a check that fails open so often it stops being a check. 20 minutes is a
 * deliberately generous floor until someone has timed an UNCONTENDED cold run
 * and can set this from real data rather than a contended outlier.
 */
const TIMEOUT_MS = Number(process.env.AF_SMOKE_TIMEOUT_MS) || 20 * 60_000
const RUN_TESTS = process.env.AF_SMOKE_RUN_TESTS === '1'

function allow(warning) {
  if (warning) process.stderr.write(`  ⚠ pre-push-smoke: ${warning} — failing open, the push is allowed.\n`)
  process.exit(0)
}

function block(reason) {
  process.stderr.write(`\n  🛑 push blocked by pre-push-smoke: ${reason}\n\n`)
  process.exit(1)
}

/**
 * Coarse machine-load check: how many OTHER `tsc.js` processes are already
 * running. This box regularly carries ~9 concurrent sessions and CLAUDE.md
 * documents them starving each other's typechecks under memory pressure — a
 * live check during this script's own development found two already running
 * at 6+GB working set each. Windows-only (the box this runs on); anywhere
 * else this returns 0 rather than guessing, which is the same "unknown means
 * don't act" stance the rest of this file takes for ambiguous signals.
 */
function concurrentTscCount() {
  if (process.platform !== 'win32') return 0
  const res = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        "Where-Object { $_.CommandLine -like '*tsc.js*' } | Measure-Object).Count",
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  )
  if (res.error || res.status !== 0) return null // couldn't tell — caller treats null as "don't skip"
  const n = Number(String(res.stdout || '').trim())
  return Number.isFinite(n) ? n : null
}

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', timeout: 15_000, windowsHide: true, ...opts }).trim()
  } catch {
    return null
  }
}

/**
 * `--git-common-dir` resolves to the PRIMARY checkout's `.git` even when run
 * from inside a worktree — that is the whole mechanism the shared push-queue
 * and pusher lock already rely on. So its parent is always the primary
 * checkout root, whether this process is running in the primary or in a
 * worktree with no `node_modules` of its own (a cherry-pick scratch worktree,
 * for instance).
 */
function commonDir() {
  let common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!common) common = git(['rev-parse', '--git-common-dir'])
  if (!common) return null
  const root = git(['rev-parse', '--show-toplevel']) || process.cwd()
  return resolve(root, common)
}

function primaryRoot() {
  const common = commonDir()
  return common ? dirname(common) : null
}

/** Find an existing node_modules to link against: this worktree's own, else
 *  the primary checkout's. Neither existing is not fatal — the ratchet's own
 *  anti-vacuity check (baseline says N errors, run found 0) catches a broken
 *  or missing install and this script treats that as an uncertain run. */
function findNodeModulesSource() {
  const here = git(['rev-parse', '--show-toplevel'])
  if (here && existsSync(join(here, 'node_modules'))) return join(here, 'node_modules')
  const primary = primaryRoot()
  if (primary && existsSync(join(primary, 'node_modules'))) return join(primary, 'node_modules')
  return null
}

// Git's porcelain output uses forward slashes even on Windows; `dir` is built
// with `path.join`, which uses backslashes there. Normalize both before
// comparing, or a real match reads as "not registered" and every run tries to
// re-add a worktree that already exists.
const norm = (p) => p.split('\\').join('/')

function worktreeEntry(dir) {
  const list = git(['worktree', 'list', '--porcelain']) || ''
  return list.split(/\n\n/).find((block) => norm(block.split('\n')[0]) === `worktree ${norm(dir)}`)
}

/**
 * Fully discard a worktree, including the "locked" state a killed
 * `git worktree add`/`checkout` can leave behind (observed while testing this
 * script: a timed-out add registers the worktree, locked, with a partial
 * checkout on disk — a plain `checkout --detach` against that then fails, and
 * would fail identically on every future run without this).
 *
 * ⚠ DOES NOT RECURSE THROUGH node_modules IF IT IS A JUNCTION/SYMLINK. This
 * repo's own history records a worktree removal that followed a node_modules
 * junction and deleted the PRIMARY checkout's real one. `rmSync` on a symlink
 * or Windows junction removes the link itself, not its target — verified by
 * this being a `symlinkSync`-created junction, never a directory copy — but
 * the ordering here still matters: unlink the link explicitly BEFORE the
 * recursive removal, so a future edit to this function can't accidentally
 * turn the top-level rmSync into a recursive one that reaches the link.
 */
function nukeWorktree(dir) {
  try {
    unlinkSync(join(dir, 'node_modules'))
  } catch {}
  git(['worktree', 'unlock', dir])
  git(['worktree', 'remove', '--force', dir])
  git(['worktree', 'prune'])
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

function ensureWorktree(dir, sha) {
  mkdirSync(dirname(dir), { recursive: true })
  const entry = worktreeEntry(dir)

  if (entry) {
    if (/(^|\n)locked/.test(entry)) git(['worktree', 'unlock', dir])
    const co = spawnSync('git', ['-C', dir, 'checkout', '--detach', '--force', sha], {
      encoding: 'utf8',
      // A checkout swap between two commits in an EXISTING worktree only
      // touches the files that differ, so this is normally fast — generous
      // anyway because this repo's own notes record Windows checkouts of
      // ~15k files taking real wall-clock time under load.
      timeout: 3 * 60_000,
      windowsHide: true,
    })
    if (co.error || co.status !== 0) {
      // Whatever state it's in, a failed reuse is not worth debugging inline —
      // discard and fall through to a fresh `add` below.
      nukeWorktree(dir)
    } else {
      return null
    }
  } else if (existsSync(dir)) {
    // A stale, unregistered directory left over from a previous failure.
    nukeWorktree(dir)
  }

  const add = spawnSync('git', ['worktree', 'add', '--detach', dir, sha], {
    encoding: 'utf8',
    // Measured: a first-time checkout of this repo's ~15k tracked files can
    // run well past a naive 30s budget on Windows. This is a one-time cost —
    // every later push reuses the worktree and only pays the checkout-swap
    // cost above.
    timeout: 5 * 60_000,
    windowsHide: true,
  })
  if (add.error || add.status !== 0) {
    return `git worktree add failed: ${(add.stderr || add.error?.message || '').trim().slice(0, 300)}`
  }
  return null
}

function ensureNodeModulesLink(worktreeDir, source) {
  const dest = join(worktreeDir, 'node_modules')
  if (existsSync(dest)) return null // already linked from a previous run, or a real install
  try {
    symlinkSync(source, dest, process.platform === 'win32' ? 'junction' : 'dir')
    return null
  } catch (err) {
    return `could not link node_modules: ${err.message}`
  }
}

/** Kill any `.tsbuildinfo` left from a previous SHA at this same worktree
 *  path — see the header comment on why a reused worktree lies otherwise. */
function clearIncrementalCache(worktreeDir) {
  let names
  try {
    names = readdirSync(worktreeDir)
  } catch {
    return
  }
  for (const name of names) {
    if (name.endsWith('.tsbuildinfo')) {
      try {
        unlinkSync(join(worktreeDir, name))
      } catch {}
    }
  }
}

/**
 * Run one ratchet script inside the isolated worktree and classify the
 * result. Exit code alone is ambiguous (see header comment), so the tool's
 * OWN wording decides the verdict.
 */
function runRatchet(worktreeDir, scriptRelPath, regressionPhrase, infraPhrase) {
  const script = join(worktreeDir, scriptRelPath)
  if (!existsSync(script)) return { verdict: 'uncertain', detail: `${scriptRelPath} not present at this sha` }

  const res = spawnSync('node', [script], {
    cwd: worktreeDir,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  })

  if (res.error) return { verdict: 'uncertain', detail: `could not start: ${res.error.message}` }
  if (res.signal) return { verdict: 'uncertain', detail: `killed by signal ${res.signal} (timeout or OOM)` }

  const text = `${res.stdout || ''}\n${res.stderr || ''}`

  if (text.includes(regressionPhrase)) {
    return { verdict: 'regression', detail: text.trim().split('\n').slice(-40).join('\n') }
  }
  if (infraPhrase && text.includes(infraPhrase)) {
    return { verdict: 'uncertain', detail: text.trim().split('\n').slice(-20).join('\n') }
  }
  if (res.status === 0) {
    return { verdict: 'pass', detail: text.trim().split('\n').slice(-5).join('\n') }
  }
  // Non-zero, no recognised regression or infra phrase: an uncaught throw or
  // an exit code this script doesn't know how to read. Treat as uncertain —
  // never block on a message this classifier does not understand.
  return { verdict: 'uncertain', detail: text.trim().split('\n').slice(-20).join('\n') }
}

function main() {
  if (process.env.AF_SKIP_SMOKE_CHECK === '1') allow()

  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch {
    allow() // no stdin — not invoked as a pre-push hook
  }

  const mainPush = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => l.trim().split(/\s+/))
    .find((f) => f[2] === 'refs/heads/main' && f[1] && !ZEROS.test(f[1]))

  if (!mainPush) allow()
  const sha = mainPush[1]

  // Skip under load BEFORE doing any expensive work — checked ahead of the
  // worktree so a busy box doesn't even pay for the checkout attempt.
  const maxConcurrent = Number(process.env.AF_SMOKE_MAX_CONCURRENT_TSC) || 2
  const busyCount = concurrentTscCount()
  if (busyCount !== null && busyCount >= maxConcurrent) {
    allow(
      `${busyCount} other tsc.js process(es) already running (limit ${maxConcurrent}) — ` +
        `skipping rather than adding to the pile`,
    )
  }

  const common = commonDir()
  if (!common) allow('no git common dir resolvable')

  const worktreeDir = join(common, 'af-smoke-worktree')
  const wtErr = ensureWorktree(worktreeDir, sha)
  if (wtErr) allow(wtErr)

  const nmSource = findNodeModulesSource()
  if (!nmSource) allow('no node_modules found anywhere to link against')
  const nmErr = ensureNodeModulesLink(worktreeDir, nmSource)
  if (nmErr) allow(nmErr)

  clearIncrementalCache(worktreeDir)

  const started = Date.now()
  process.stderr.write(`  … pre-push-smoke: typechecking ${sha.slice(0, 9)} in isolation…\n`)

  const ts = runRatchet(
    worktreeDir,
    join('scripts', 'ts-error-ratchet.mjs'),
    'gained TypeScript errors',
    null, // ts-error-ratchet's own infra failures throw uncaught, no fixed phrase — caught by the default "uncertain" fallthrough
  )

  if (ts.verdict === 'regression') {
    block(
      `TypeScript ratchet found new errors relative to this commit's own baseline.\n\n${ts.detail}\n\n` +
        `  Fix the regressions above, or if intentional, re-baseline in the SAME commit:\n` +
        `     npm run ts:ratchet:update\n\n` +
        `  Genuinely urgent?  AF_SKIP_SMOKE_CHECK=1 git push <args>\n`,
    )
  }
  if (ts.verdict === 'uncertain') {
    process.stderr.write(`  ⚠ pre-push-smoke: typecheck ratchet run was inconclusive:\n${ts.detail}\n`)
  } else {
    process.stderr.write(`  ✅ pre-push-smoke: no TypeScript regressions (${Math.round((Date.now() - started) / 1000)}s).\n`)
  }

  if (RUN_TESTS) {
    const vt = runRatchet(
      worktreeDir,
      join('scripts', 'vitest-ratchet.mjs'),
      'were passing and now FAIL',
      'infrastructure failure',
    )
    if (vt.verdict === 'regression') {
      block(
        `Vitest ratchet found files that were passing and now fail.\n\n${vt.detail}\n\n` +
          `  Fix the regressions above, or if intentional, re-baseline in the SAME commit:\n` +
          `     npm run test:ratchet:update\n\n` +
          `  Genuinely urgent?  AF_SKIP_SMOKE_CHECK=1 git push <args>\n`,
      )
    }
    if (vt.verdict === 'uncertain') {
      process.stderr.write(`  ⚠ pre-push-smoke: vitest ratchet run was inconclusive:\n${vt.detail}\n`)
    } else {
      process.stderr.write(`  ✅ pre-push-smoke: no vitest regressions.\n`)
    }
  }

  process.exit(0)
}

try {
  main()
} catch (err) {
  // The catch-all is the fail-open promise: an unexpected throw in THIS
  // wrapper must never be the reason a push is stuck, even though a
  // regression reported BY the ratchets it calls still blocks above.
  allow(`unexpected error: ${err?.message}`)
}
