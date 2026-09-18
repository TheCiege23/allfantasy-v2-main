/**
 * `pre-push-smoke` must not typecheck a tree that is neither commit.
 *
 * WHAT HAPPENED (measured 2026-09-17)
 * The isolated worktree is ONE fixed path shared by every session, and nothing stopped two runs
 * entering it at once. A push of `613dd5c37` was BLOCKED on three files, two of which
 * (`app/api/decision-os/league-context/route.ts`, `.../mission-control/route.ts`) are not in that
 * commit at all — `git ls-tree 613dd5c37 -- <path>` is empty for both. They belong to
 * `1a0759208`, another session's unlanded commit, which is what the shared worktree's HEAD read
 * afterwards.
 *
 * The reuse mechanism was never the problem: running `ensureWorktree`'s own
 * `git checkout --detach --force <sha>` against that worktree uncontended moved HEAD to the right
 * commit, left zero dirty paths, and removed both phantom files. Contention was the whole defect.
 *
 * ⚠ THE SHAPE, AGAIN: a check that passes — or here, FAILS — against an artifact nobody is
 * shipping. It is worse than a check that cannot fail, because it is wrong in both directions. It
 * blocked a clean commit on a stranger's errors, and it would just as happily have cleared a
 * broken commit on a stranger's clean files.
 *
 * The guard reuses the queue's own `smoke-active/<sha>.json` marker rather than taking a second
 * lock: that file already exists per in-flight run and is already removed on every exit path.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(process.cwd(), 'scripts/pre-push-smoke.mjs')
const ZERO = '0'.repeat(40)
const MINE = '613dd5c373b8709991660223bb645a6f53710889'
const THEIRS = '1a0759208111111111111111111111111111111a'
const FIRED = /another session's smoke is already in the shared worktree/

const made: string[] = []
afterEach(() => {
  for (const p of made.splice(0)) {
    try {
      rmSync(p, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function queueWith(markers: Array<{ sha: string; ageMs: number }>): string {
  const queue = mkdtempSync(join(tmpdir(), 'af-smoke-contention-'))
  made.push(queue)
  const active = join(queue, 'smoke-active')
  mkdirSync(active, { recursive: true })
  for (const m of markers) {
    writeFileSync(
      join(active, `${m.sha}.json`),
      JSON.stringify({ sha: m.sha, pid: 1, startedAt: Date.now() - m.ageMs }),
    )
  }
  return queue
}

/**
 * Run the real script as a pre-push hook and report only whether the contention guard spoke.
 *
 * ⚠ THE TIMEOUT IS NOT A VERDICT, AND IS LOAD-BEARING FOR THE NEGATIVES. The guard decides
 * within the first moments — it sits before `chooseWorktreeDir`, deliberately, so a run that is
 * going to skip never pays for a checkout. A run that does NOT skip then goes on to check out
 * ~15k files and compile them, which is minutes. So the spawn is cut short: `status` comes back
 * null, which is neither 0 nor 1 and means nothing, and every assertion here is on the guard's
 * own sentence rather than on the exit code.
 *
 * ⚠ THE FIRST VERSION OF THIS FILE LET THE NEGATIVES RUN TO 45s AND THEY FAILED ON VITEST'S OWN
 * 30s CEILING — three red tests that said nothing about the guard. Kept short here, with each
 * test's ceiling raised above it, so a red result can only mean the guard misfired.
 */
const RUN_MS = 10_000

function guardFired(queue: string): boolean {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: `refs/heads/main ${MINE} refs/heads/main ${ZERO}\n`,
    encoding: 'utf8',
    env: {
      ...process.env,
      AF_PUSH_QUEUE_DIR: queue,
      // Never let the load check pre-empt the case under test: it also skips, with a different
      // sentence, and a test that cannot tell the two apart would pass on a busy box for the
      // wrong reason.
      AF_SMOKE_MAX_CONCURRENT_TSC: '99',
    },
    timeout: RUN_MS,
  })
  return FIRED.test(`${r.stderr ?? ''}${r.stdout ?? ''}`)
}

/** Above `RUN_MS`, so a failure is the guard's doing and never the harness's. */
const CASE_MS = RUN_MS + 20_000

describe('pre-push-smoke — a shared worktree with two runs in it', () => {
  it(
    'skips when another sha is mid-run',
    () => {
      expect(guardFired(queueWith([{ sha: THEIRS, ageMs: 30_000 }]))).toBe(true)
    },
    CASE_MS,
  )

  /*
   * 🛑 THE THREE NEGATIVES ARE THE POINT. A guard that fires on everything is a permanent skip,
   * which retires the whole typecheck gate silently — the same cost as the bug it replaced, paid
   * in the other direction. Each of these is a state that LOOKS like contention and is not.
   */
  it(
    'does not fire on a marker older than the smoke ceiling — a dead run must not disable it forever',
    () => {
      expect(guardFired(queueWith([{ sha: THEIRS, ageMs: 21 * 60_000 }]))).toBe(false)
    },
    CASE_MS,
  )

  it(
    'does not fire on our own marker, which this run wrote moments earlier',
    () => {
      expect(guardFired(queueWith([{ sha: MINE, ageMs: 1_000 }]))).toBe(false)
    },
    CASE_MS,
  )

  it(
    'does not fire when nothing is in flight',
    () => {
      expect(guardFired(queueWith([]))).toBe(false)
    },
    CASE_MS,
  )
})
