/**
 * "Is the commit I pushed live yet?" — the wait half of verify-deployed-redirects.mjs,
 * kept in its own module so it can be tested without running the live probes.
 *
 * ⚠ WHY THIS IS NOT "WAIT FOR THE EXACT SHA". Measured on Railway 2026-09-24: every push
 * gets its OWN build, the builds run CONCURRENTLY (five or six were in flight at once that
 * afternoon), and each takes ~16–21 minutes. Production therefore routinely jumps straight
 * past a commit — `96a60e43b` and `aa2a59729` were created at 19:25 and 19:28, and the next
 * thing production served was `e5f038706` at 19:45. Their code was live inside it; they were
 * never served by name. An exact match waits for that forever and reports NOT_DEPLOYED about
 * code that is running. So the question asked here is "does what production serves CONTAIN
 * the commit?", and a descendant answers yes.
 *
 * ⚠ AND "CONTAINS" HAS THREE ANSWERS, NOT TWO. `true` — the served commit is the pushed one
 * or a descendant of it. `false` — it is older, or on another line of history. `null` — we
 * could not tell (GitHub unreachable, rate-limited, an unknown commit). `null` is never
 * treated as either verdict: reading "could not tell" as "no" reports a false NOT_DEPLOYED,
 * and reading it as "yes" probes a build that may not have the change — the second is the
 * exact lie this whole check exists to prevent.
 *
 * No dependencies, like the script that uses it: global fetch, and git only as a fallback.
 */

import { execFileSync } from 'node:child_process'

export const DEFAULT_WAIT_MINUTES = 40
const MAX_WAIT_MINUTES = 120

/**
 * The wait budget, from `--wait-minutes=N` or VERIFY_WAIT_MINUTES, else the default.
 * A value that is not a positive number up to two hours is ignored rather than trusted:
 * a typo must not turn the wait into zero (instant NOT_DEPLOYED) or into a runner-hogging day.
 */
export function parseWaitMinutes(args = [], env = {}) {
  const flag = args.find((a) => a.startsWith('--wait-minutes='))
  for (const raw of [flag?.slice('--wait-minutes='.length), env.VERIFY_WAIT_MINUTES]) {
    if (raw === undefined || String(raw).trim() === '') continue
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n <= MAX_WAIT_MINUTES) return n
  }
  return DEFAULT_WAIT_MINUTES
}

/** The same commit, whether either side is given full-length or abbreviated. */
export function sameCommit(a, b) {
  if (!a || !b) return false
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  const n = Math.min(x.length, y.length)
  return n >= 7 && x.slice(0, n) === y.slice(0, n)
}

/**
 * What the wait loop should do about one reading of production.
 *
 *   'deployed'     it IS the pushed commit
 *   'descendant'   a newer commit that contains it — the change is live, verify this build
 *   'not-yet'      older, or another line of history — keep waiting
 *   'undetermined' could not tell — keep waiting, and say so if the budget runs out
 *   'unreadable'   /api/af-debug/sha gave no sha (restarting container) — keep waiting
 */
export function classifyServed(expected, served, contains) {
  if (!served) return 'unreadable'
  if (sameCommit(expected, served)) return 'deployed'
  if (contains === true) return 'descendant'
  if (contains === false) return 'not-yet'
  return 'undetermined'
}

/**
 * Does `served` contain `expected`? `true` / `false` / `null`, per the header.
 *
 * GitHub's compare API first, because it needs no history on disk: CI checks out ONE commit
 * (fetch-depth 1), so a local `git merge-base` cannot see the served commit at all there.
 * Local git second, for a developer running this from a full clone. Its exit status is read
 * three ways — 0 yes, 1 no, anything else NOT A VERDICT — because this repo has already
 * mistaken a timeout's 124 and a missing binary's 127 for answers.
 */
export async function servedContains(
  expected,
  served,
  {
    repo = process.env.GITHUB_REPOSITORY || 'TheCiege23/allfantasy-v2-main',
    token = process.env.GITHUB_TOKEN,
    fetchImpl = fetch,
    gitAncestor = localGitIsAncestor,
  } = {},
) {
  try {
    const url = `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(expected)}...${encodeURIComponent(served)}?per_page=1`
    const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
    if (token) headers.authorization = `Bearer ${token}`
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) })
    if (res.ok) {
      const body = await res.json()
      // base...head: "ahead" means head (served) has everything base (expected) has, and more.
      if (body?.status === 'ahead' || body?.status === 'identical') return true
      if (body?.status === 'behind' || body?.status === 'diverged') return false
    }
  } catch {
    // Fall through to local git. An unreachable API is not evidence either way.
  }
  return gitAncestor(expected, served)
}

function localGitIsAncestor(expected, served) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', expected, served], { stdio: 'ignore', timeout: 15_000 })
    return true
  } catch (err) {
    return err && typeof err === 'object' && err.status === 1 ? false : null
  }
}

/**
 * Poll /api/af-debug/sha until production serves the pushed commit or a descendant of it,
 * or the budget runs out. Every dependency is injectable so the loop is testable without a
 * network or a real clock.
 *
 * Returns `{ deployed, sha, via, relation, waitedMs }`:
 *   deployed  true once the change is live
 *   via       'exact' | 'descendant' when deployed
 *   relation  the last classification — what to tell a human when it never arrived
 */
export async function waitForSha(
  expected,
  {
    budgetMs = DEFAULT_WAIT_MINUTES * 60_000,
    pollMs = 30_000,
    readServedSha,
    contains = servedContains,
    now = Date.now,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = console.log,
  } = {},
) {
  const started = now()
  const deadline = started + budgetMs
  const verdictBySha = new Map() // definite answers only; `null` is asked again next time
  let lastSha = null
  let relation = 'unreadable'
  let reported = null

  while (now() < deadline) {
    let served = null
    try {
      served = await readServedSha()
    } catch {
      // A cold or restarting container is expected while a deploy lands. Keep waiting.
    }
    if (served) lastSha = served

    let verdict = null
    if (served && !sameCommit(expected, served)) {
      if (verdictBySha.has(served)) {
        verdict = verdictBySha.get(served)
      } else {
        verdict = await contains(expected, served)
        if (verdict !== null) verdictBySha.set(served, verdict)
      }
    }
    relation = classifyServed(expected, served, verdict)

    if (relation === 'deployed' || relation === 'descendant') {
      return { deployed: true, sha: served, via: relation === 'deployed' ? 'exact' : 'descendant', relation, waitedMs: now() - started }
    }

    // One line per CHANGE, so a run's log is a timeline of what production served and for
    // how long — the measurement that showed 15 minutes had stopped being enough.
    const line = `${served ?? '-'}|${relation}`
    if (line !== reported) {
      reported = line
      const mins = Math.round((now() - started) / 60_000)
      log(`  [${mins}m] production serves ${served ? served.slice(0, 9) : '(no answer)'} — ${describe(relation)}`)
    }
    await sleep(pollMs)
  }
  return { deployed: false, sha: lastSha, via: null, relation, waitedMs: now() - started }
}

export function describe(relation) {
  switch (relation) {
    case 'not-yet':
      return 'older than the pushed commit (or on another line); still waiting'
    case 'undetermined':
      return 'could not tell whether it contains the pushed commit (GitHub compare unavailable); still waiting'
    case 'unreadable':
      return 'no sha reported (container starting?); still waiting'
    default:
      return relation
  }
}
