#!/usr/bin/env node
/**
 * Refuse a push to `main` while a production build is already running.
 *
 * WHY THIS EXISTS
 * Build CPU Minutes were the entire Vercel bill: $100.90 of a $101.40 invoice
 * (34,338 minutes). Two thirds of that is push frequency, not configuration.
 * Measured over 4.7 days: 326 production builds, and 165 of them STARTED BEFORE
 * THE PREVIOUS ONE FINISHED (median overlap 2.5 min). None were cancelled --
 * preview builds auto-cancel on this project, production ones do not -- so each
 * of those 165 ran to completion and was superseded within ~2 minutes. That is
 * ~137 build-min/day of output nobody ever served.
 *
 * The overlap is NOT one session pushing a burst: only 6% of overlapping pairs
 * share a commit scope. It is ~9 concurrent sessions on one checkout pushing
 * independently, 198 of 325 pushes landing within 5 minutes of the previous.
 * That makes it a coordination problem, and a convention between independent
 * sessions decays invisibly -- which is exactly how 71 builds/day went unnoticed
 * for months. This hook is the version that needs no agreement: a session that
 * has never heard of the convention still gets stopped.
 *
 * ⚠ IT FAILS OPEN, DELIBERATELY. Every error path -- no Vercel CLI, no auth, a
 * network stall, an unparseable payload, a timeout -- exits 0 and lets the push
 * through. A cost guard that can strand a deploy is worse than the cost. The
 * only exit-1 is a positive, parsed confirmation that a build is in flight.
 *
 * Override for a genuine emergency:  AF_ALLOW_CONCURRENT_PUSH=1 git push ...
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Public identifiers -- they appear in every deployment URL, so they are not
// secrets. They are passed explicitly because `.vercel/` is gitignored and does
// NOT exist in the ~70 worktrees this repo runs from; relying on the project
// link would silently disable the guard everywhere except the primary checkout.
// 🛑 DO NOT "CORRECT" THESE FROM A `vercel ls` FAILURE. THAT WAS DONE ON
// 2026-08-31 AND IT BROKE THE GUARD.
//
// The values below are RIGHT: production deploys run as
// `allfantasy-v2-main-a6wc` under the `cafeconchimmy-1100s-projects` scope.
//
// What happened: a CLI session authenticated to a DIFFERENT team (`cafeconchimmy`)
// ran `vercel ls … --scope cafeconchimmy-1100s-projects` and got
// "The specified scope does not exist". That message means "this token cannot see
// it", NOT "it is not there" — an AUTHORIZATION failure reading exactly like a
// configuration error. `vercel project ls` then listed a stale look-alike,
// `allfantasy-v2-main` under `cafeconchimmy`, whose newest deployment was ten days
// old. Pointing the guard at that project made it watch something nobody deploys,
// and produced a confident, entirely false conclusion that production had not
// built in nine days.
//
// ⚠ BEFORE CHANGING THESE, CONFIRM WHICH TEAM YOUR CLI IS IN: `vercel teams ls`.
// If the scope below is not listed, you cannot verify these constants from this
// machine and an empty/erroring `vercel ls` tells you nothing about them.
//
// ⚠ AND THE STANDING HAZARD IS STILL REAL, which is why this note is long: a
// fail-open guard cannot report its own misconfiguration. A wrong constant here is
// indistinguishable from "no build is running", forever. But the fix for that is a
// deploy-listing you have actually seen for THIS project — not a rename driven by
// a command that failed for a reason you did not check.
const PROJECT = process.env.AF_VERCEL_PROJECT || 'allfantasy-v2-main-a6wc'
const SCOPE = process.env.AF_VERCEL_SCOPE || 'cafeconchimmy-1100s-projects'

// States that mean a build is burning CPU minutes right now.
const IN_FLIGHT = new Set(['BUILDING', 'QUEUED', 'INITIALIZING'])

// Measured mean for a production build that follows a gap (a cold cache).
const TYPICAL_BUILD_MIN = 5.9

const allow = () => process.exit(0)

/**
 * Fail open, but SAY SO.
 *
 * 🛑 THE HEADER ABOVE NAMES THIS AS THE STANDING HAZARD: "a fail-open guard cannot report
 * its own misconfiguration. A wrong constant here is indistinguishable from 'no build is
 * running', forever." That was true because every error path called `allow()`, which exits
 * 0 in silence — so a guard that had never once been able to check looked exactly like a
 * guard that checked and found nothing.
 *
 * It has been in that state. Three sessions independently concluded on 2026-09-01 that the
 * guard was inert, and one of them nearly "fixed" it by repointing the constants — the
 * precise mistake the header warns against, made for the second time, because a silent
 * allow gave them nothing to distinguish "cannot see the scope" from "nothing is building".
 *
 * The guard still lets the push through: stranding a deploy is worse than the cost, and
 * that judgement has not changed. What changes is that it now tells you it did not check,
 * so an unverifiable guard announces itself instead of impersonating a passing one.
 *
 * ⚠ WRITTEN TO STDERR, NOT STDOUT, and it never exits non-zero: a pre-push hook's stdout
 * can be consumed by tooling, and this must not become a new way to block a push.
 */
const allowUnchecked = (reason, detail) => {
  process.stderr.write(
    `\n[inflight-build-guard] NOT CHECKED — ${reason}\n` +
      (detail ? `  ${detail}\n` : '') +
      `  Looking for: project "${PROJECT}" in scope "${SCOPE}".\n` +
      `  These constants are believed CORRECT — see the header before changing them.\n` +
      `  "The specified scope does not exist" means this CLI token cannot see the scope,\n` +
      `  not that the project is missing. Confirm with: vercel teams ls\n` +
      `  Letting the push through anyway. Concurrent production builds are NOT being\n` +
      `  prevented right now, so check with the room before pushing.\n\n`,
  )
  process.exit(0)
}

if (process.env.AF_ALLOW_CONCURRENT_PUSH === '1') allow()

/** Pre-push feeds `<localRef> <localSha> <remoteRef> <remoteSha>` on stdin. */
function pushesToMain() {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch {
    return false // No stdin to read -- cannot confirm, so do not block.
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .some((line) => {
      const remoteRef = line.trim().split(/\s+/)[2] || ''
      return remoteRef === 'refs/heads/main'
    })
}

// Only `main` builds -- vercel.json's ignoreCommand skips every other ref, so a
// feature-branch push costs seconds and is none of this hook's business.
if (!pushesToMain()) allow()

const res = spawnSync(
  `vercel ls ${PROJECT} --environment production --limit 5 --scope ${SCOPE} --json`,
  { shell: true, encoding: 'utf8', timeout: 12_000, windowsHide: true },
)

/*
 * ⚠ EACH OF THESE WAS A BARE `allow()` AND THEY ARE THE WHOLE PROBLEM. A missing CLI, an
 * unauthorised scope, a timeout and a malformed payload all exited 0 in silence, which is
 * byte-identical to "checked, nothing running". They are distinguished now because the
 * distinction is the only thing that tells you the guard needs fixing.
 */
if (res.error) {
  allowUnchecked('the vercel CLI could not be run', String(res.error.message || res.error))
}
if (res.status !== 0) {
  const stderr = String(res.stderr || '').trim().split('\n')[0] || '(no stderr)'
  allowUnchecked(`vercel ls exited ${res.status}`, stderr)
}
if (!res.stdout) {
  allowUnchecked('vercel ls produced no output', 'exit was 0 but stdout was empty')
}

let deployments
try {
  deployments = JSON.parse(res.stdout).deployments
} catch (err) {
  allowUnchecked('could not parse the vercel ls payload', String(err))
}
if (!Array.isArray(deployments)) {
  allowUnchecked('the payload had no deployments array', 'shape changed, or the project is empty')
}

const running = deployments.filter((d) => IN_FLIGHT.has(String(d.state).toUpperCase()))
if (running.length === 0) allow()

const started = Math.min(...running.map((d) => d.buildingAt || d.createdAt || Date.now()))
const elapsedMin = (Date.now() - started) / 60000
const remainingMin = Math.max(0, TYPICAL_BUILD_MIN - elapsedMin)

process.stderr.write(
  `\n  ✋ push blocked: a production build is already running.\n\n` +
    `     running for   ${elapsedMin.toFixed(1)} min (a cold build averages ${TYPICAL_BUILD_MIN} min)\n` +
    `     retry in      ~${Math.ceil(remainingMin) || 1} min\n\n` +
    `  Pushing now starts a second build that supersedes the first before it\n` +
    `  finishes. Both are billed; only one is ever served. 165 of 326 production\n` +
    `  builds went that way in one 4.7-day window.\n\n` +
    `  Nothing is lost by waiting -- keep committing, then push the batch. A push\n` +
    `  is a deploy; a commit is not.\n\n` +
    `  Genuinely urgent?  AF_ALLOW_CONCURRENT_PUSH=1 git push <args>\n\n`,
)
process.exit(1)
