#!/usr/bin/env node
/**
 * Refuse a push to `main` while a production build is already running.
 *
 * WHY THIS EXISTS
 * Build minutes were the entire hosting bill. Measured over 4.7 days on the
 * previous host: 326 production builds, and 165 of them STARTED BEFORE THE
 * PREVIOUS ONE FINISHED (median overlap 2.5 min). None were cancelled, so each
 * ran to completion and was superseded within ~2 minutes -- ~137 build-min/day
 * of output nobody ever served.
 *
 * The overlap is NOT one session pushing a burst: only 6% of overlapping pairs
 * share a commit scope. It is ~9 concurrent sessions on one checkout pushing
 * independently. That makes it a coordination problem, and a convention between
 * independent sessions decays invisibly -- which is how 71 builds/day went
 * unnoticed for months. This hook is the version that needs no agreement: a
 * session that has never heard of the convention still gets stopped.
 *
 * IT FAILS OPEN, DELIBERATELY. Every error path -- no CLI, no auth, a network
 * stall, an unparseable payload, a timeout -- exits 0 and lets the push through.
 * A cost guard that can strand a deploy is worse than the cost. The only exit-1
 * is a positive, parsed confirmation that a build is in flight.
 *
 * Override for a genuine emergency:  AF_ALLOW_CONCURRENT_PUSH=1 git push ...
 *
 * -----------------------------------------------------------------------------
 * PORTED FROM VERCEL TO RAILWAY, 2026-09-04, BECAUSE IT HAD STOPPED CHECKING.
 *
 * Production moved to Railway on 2026-09-02. This script still ran `vercel ls`,
 * which exited non-zero on every push, so it printed "NOT CHECKED" and allowed
 * everything. It was inert for two days: five pushes on the night of 09-04 each
 * reported `vercel ls exited 1`, and two production builds ran CONCURRENTLY at
 * 11:43 and 11:46 -- one of them a rebuild of a commit that had already built
 * successfully. Exactly the waste this guard exists to prevent, while the guard
 * watched a platform nobody deploys to.
 *
 * THE OLD HEADER'S WARNING STILL APPLIES AND IS WORTH RESTATING, because this
 * change is the very thing it warned against -- repointing the constants -- and
 * it is only correct because the evidence is different in kind. On 2026-08-31
 * someone repointed the Vercel constants after `vercel ls` FAILED, reasoning
 * backwards from an error message; that failure was an AUTHORIZATION problem
 * ("the specified scope does not exist" means this token cannot see it), and the
 * repoint aimed the guard at a stale look-alike project nobody deploys.
 *
 * This port is NOT that. It rests on a positive deploy listing for THIS service:
 * `railway status` shows service `allfantasy-v2-main` serving https://allfantasy.ai
 * from repo TheCiege23/allfantasy-v2-main, and its deployment list carries the
 * exact commit SHAs pushed to main tonight (cfa43d909, 7413bb612, 9bbaba732).
 * That is a listing someone has actually seen, not a rename driven by a command
 * that failed for a reason nobody checked.
 *
 * BEFORE CHANGING THE CONSTANTS BELOW, get a deploy listing you have seen for
 * this service:  railway status  &&  railway deployment list --limit 5
 * -----------------------------------------------------------------------------
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Public identifiers -- they appear in the Railway dashboard and in deploy URLs,
// so they are not secrets.
//
// THE WORKER SERVICE IS DELIBERATELY NOT WATCHED. `allfantasy-v2-worker` runs the
// cron work on its own service and builds on its own schedule; a `main` push does
// not supersede its build, so counting it would block pushes over a build this
// hook has no quarrel with.
const SERVICE = process.env.AF_RAILWAY_SERVICE || '26e55ff8-c945-4526-8523-f6bfa723357e'
const ENVIRONMENT = process.env.AF_RAILWAY_ENVIRONMENT || 'production'

// States where a deploy pipeline is live. BUILDING/INITIALIZING/QUEUED/WAITING
// are burning build minutes outright; DEPLOYING has finished building but a new
// push still discards a build that was paid for and never served, which is the
// same waste one step later.
const IN_FLIGHT = new Set(['BUILDING', 'INITIALIZING', 'QUEUED', 'WAITING', 'DEPLOYING'])

// APPROXIMATE, and deliberately marked as such rather than carried over from
// Vercel's measured 5.9. Railway builds observed on 2026-09-04 ran longer -- the
// 11:46 build was still going at 13 min. This figure only shapes the "retry in
// ~N min" hint; it never decides whether a push is blocked. Refine it when
// someone has timed a run of Railway builds properly.
const TYPICAL_BUILD_MIN = 9

const allow = () => process.exit(0)

/**
 * Fail open, but SAY SO.
 *
 * A FAIL-OPEN GUARD CANNOT REPORT ITS OWN MISCONFIGURATION. A wrong constant here
 * is indistinguishable from "no build is running", forever -- which is exactly the
 * state this script sat in for two days after production moved to Railway. Every
 * error path used to exit 0 in silence, so a guard that had never once been able
 * to check looked identical to one that checked and found nothing.
 *
 * The guard still lets the push through: stranding a deploy is worse than the
 * cost. What it does now is TELL you it did not check, so an unverifiable guard
 * announces itself instead of impersonating a passing one. That announcement is
 * what got this port written -- five "NOT CHECKED" lines in one night are a
 * signal; five silent exits would not have been.
 *
 * WRITTEN TO STDERR, NOT STDOUT, and it never exits non-zero: a pre-push hook's
 * stdout can be consumed by tooling, and this must not become a new way to block.
 */
const allowUnchecked = (reason, detail) => {
  process.stderr.write(
    `\n[inflight-build-guard] NOT CHECKED — ${reason}\n` +
      (detail ? `  ${detail}\n` : '') +
      `  Looking for: Railway service "${SERVICE}" in environment "${ENVIRONMENT}".\n` +
      `  Verify with:  railway status  &&  railway deployment list --limit 5\n` +
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

if (!pushesToMain()) allow()

/*
 * THE RAILWAY CLI RESOLVES ITS PROJECT FROM THE CURRENT DIRECTORY, AND THERE IS NO
 * --project FLAG. `railway deployment list` in an unlinked directory prints
 * "No linked project found" and exits non-zero.
 *
 * This repo runs from ~70 worktrees, none of them linked. Invoking the CLI with
 * the hook's own cwd would therefore fail-open in every worktree and check only in
 * the primary checkout -- a guard that silently does nothing almost everywhere,
 * which is the precise failure mode the header above is about.
 *
 * `git rev-parse --git-common-dir` points at the PRIMARY checkout's .git from
 * inside any worktree, so its parent is the linked directory. Verified from a
 * detached worktree on 2026-09-04: the cwd-less invocation failed with "No linked
 * project found", and this one returned the deployment list.
 */
function linkedRoot() {
  const res = spawnSync('git rev-parse --git-common-dir', {
    shell: true,
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  })
  if (res.status !== 0 || !res.stdout) return null
  const common = res.stdout.trim()
  if (!common) return null
  return common.endsWith('.git') ? dirname(common) : null
}

const root = linkedRoot()
if (!root) {
  allowUnchecked(
    'could not locate the linked checkout',
    'git rev-parse --git-common-dir gave nothing usable',
  )
}

const res = spawnSync(
  `railway deployment list --service ${SERVICE} --environment ${ENVIRONMENT} --limit 5 --json`,
  { shell: true, encoding: 'utf8', timeout: 20_000, windowsHide: true, cwd: root },
)

if (res.error) {
  allowUnchecked('the railway CLI could not be run', String(res.error.message || res.error))
}
if (res.status !== 0) {
  const stderr = String(res.stderr || '').trim().split('\n')[0] || '(no stderr)'
  allowUnchecked(`railway deployment list exited ${res.status}`, stderr)
}
if (!res.stdout) {
  allowUnchecked('railway deployment list produced no output', 'exit was 0 but stdout was empty')
}

/*
 * RAILWAY RETURNS A BARE ARRAY, not Vercel's { deployments: [...] }. Reading
 * `.deployments` off it yields undefined, which the Array.isArray check below
 * turns into an honest "shape changed" rather than a silent zero-length filter
 * that would report "nothing is building" for every push.
 */
let deployments
try {
  deployments = JSON.parse(res.stdout)
} catch (err) {
  allowUnchecked('could not parse the railway payload', String(err))
}
if (!Array.isArray(deployments)) {
  allowUnchecked('the payload was not an array', 'shape changed, or the service has no deployments')
}

const running = deployments.filter((d) => IN_FLIGHT.has(String(d.status).toUpperCase()))
if (running.length === 0) allow()

const started = Math.min(
  ...running.map((d) => {
    const t = Date.parse(d.createdAt || '')
    return Number.isFinite(t) ? t : Date.now()
  }),
)
const elapsedMin = (Date.now() - started) / 60000
const remainingMin = Math.max(0, TYPICAL_BUILD_MIN - elapsedMin)

process.stderr.write(
  `\n  push blocked: a production build is already running.\n\n` +
    `     service       ${SERVICE}\n` +
    `     state         ${running.map((d) => d.status).join(', ')}\n` +
    `     running for   ${elapsedMin.toFixed(1)} min (a build averages ~${TYPICAL_BUILD_MIN} min)\n` +
    `     retry in      ~${Math.ceil(remainingMin) || 1} min\n\n` +
    `  Pushing now starts a second build that supersedes the first before it\n` +
    `  finishes. Both are billed; only one is ever served. 165 of 326 production\n` +
    `  builds went that way in one 4.7-day window.\n\n` +
    `  Nothing is lost by waiting -- keep committing, then push the batch. A push\n` +
    `  is a deploy; a commit is not.\n\n` +
    `  Genuinely urgent?  AF_ALLOW_CONCURRENT_PUSH=1 git push <args>\n\n`,
)
process.exit(1)
