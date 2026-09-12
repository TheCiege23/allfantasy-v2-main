/**
 * The push queue's own guard rail.
 *
 * 🛑 EVERY CASE HERE REPRODUCES A KNOWN POSITIVE BEFORE TRUSTING A NEGATIVE.
 * A queue that never once refuses a push is indistinguishable from no queue at
 * all, and it would go unnoticed for exactly as long as the duplicate-build
 * problem did — so the first assertion in this file is that the block FIRES,
 * with a real exit 1, and only then do the allow paths mean anything.
 *
 * The script is exercised as a subprocess through the same entry point the
 * pre-push hook uses (stdin payload + `check`), not by importing its internals,
 * because the failure mode being guarded against is the hook wiring, not the
 * arithmetic.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts', 'push-queue.mjs')

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)

let queueDir: string

beforeEach(() => {
  queueDir = mkdtempSync(join(tmpdir(), 'af-push-queue-'))
})

afterEach(() => {
  rmSync(queueDir, { recursive: true, force: true })
})

type RunResult = { status: number; stdout: string; stderr: string }

/**
 * Run a verb exactly as the hook does: payload on stdin, never on argv.
 *
 * `spawnSync`, not `execFileSync`, because the guard's most important output —
 * why it allowed a push it might have blocked — goes to stderr on a SUCCESSFUL
 * exit, and `execFileSync` only surfaces stderr when it throws.
 */
function run(
  args: string[],
  payload: string,
  env: Record<string, string> = {},
  cwd?: string,
): RunResult {
  const res = spawnSync('node', [SCRIPT, ...args], {
    input: payload,
    encoding: 'utf8',
    // Defaults to the repo, which is what every case but the ancestry ones wants.
    // Those build their own repo so they do not depend on this checkout's refs —
    // see the `already on main` block below.
    cwd,
    env: {
      ...process.env,
      AF_PUSH_QUEUE_DIR: queueDir,
      // No network in a unit test: the `landed on origin/main` reconciliation is
      // left off here so a flaky ls-remote cannot decide whether the queue blocks.
      AF_PUSH_QUEUE_NO_REMOTE: '1',
      // 🛑 AND NO PROCESS TABLE EITHER. The short grace defers to a running
      // compile, and this box genuinely runs peers' `tsc` most of the time — so
      // without pinning this, every short-grace assertion below would pass or
      // fail according to what a DIFFERENT session happened to be doing. '0'
      // means "no compile in flight"; the cases that exercise the deferral set
      // it to '1' explicitly.
      AF_PUSH_QUEUE_ASSUME_TSC: '0',
      ...env,
    },
  })
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

const mainPayload = (sha: string) => `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`

const check = (sha: string, env?: Record<string, string>, cwd?: string) =>
  run(['check'], mainPayload(sha), env, cwd)

const tickets = () =>
  readdirSync(queueDir)
    .filter((n) => /^\d{6}\.json$/.test(n))
    .sort()
    .map((n) => JSON.parse(readFileSync(join(queueDir, n), 'utf8')) as Record<string, unknown>)

/** Hand-place a ticket so ordering is set by the test, not by timing. */
function seed(seq: number, sha: string, extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(queueDir, `${String(seq).padStart(6, '0')}.json`),
    JSON.stringify({
      seq,
      sha,
      label: `seeded ${seq}`,
      branch: 'main',
      worktree: '',
      state: 'waiting',
      createdAt: Date.now(),
      heartbeatAt: Date.now(),
      ...extra,
    }),
  )
}

/**
 * Stand in for `pre-push-smoke.mjs` announcing a run in progress.
 *
 * Written as a plain file rather than by invoking the smoke, deliberately: what
 * is under test here is the queue's reading of the marker, and driving the real
 * smoke would need a git worktree, a node_modules link and a cold compile to
 * assert an arithmetic branch. The cost of that choice is that the two scripts
 * could drift apart on the PATH, so the marker's location is asserted from the
 * smoke's own source in the contract test at the bottom of this file.
 */
function seedSmokeMarker(sha: string, startedAt = Date.now()) {
  mkdirSync(join(queueDir, 'smoke-active'), { recursive: true })
  writeFileSync(
    join(queueDir, 'smoke-active', `${sha}.json`),
    JSON.stringify({ sha, pid: 1234, startedAt }),
  )
}

describe('push-queue — the block fires (known positive)', () => {
  it('refuses a push that is not at the head of the line, with exit 1', () => {
    seed(1, SHA_A)

    const res = check(SHA_B)

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('it is not your turn')
    expect(res.stderr).toContain('position      2 of 2')
  })

  it('names who is ahead, so a blocked session can tell whether the line is real', () => {
    seed(1, SHA_A)
    const res = check(SHA_B)
    expect(res.stderr).toContain(SHA_A.slice(0, 9))
  })
})

describe('push-queue — the allow paths', () => {
  it('waves through a lone session, and gives it a ticket it did not ask for', () => {
    const res = check(SHA_A)

    expect(res.status).toBe(0)
    expect(res.stderr).toContain('at the head of the line')
    expect(tickets()).toHaveLength(1)
    expect(tickets()[0]).toMatchObject({ sha: SHA_A, state: 'pushing' })
  })

  it('ignores a push that is not to main, and takes no ticket for it', () => {
    const res = run(['check'], `refs/heads/feature ${SHA_A} refs/heads/feature ${'0'.repeat(40)}\n`)

    expect(res.status).toBe(0)
    expect(tickets()).toHaveLength(0)
  })

  it('ignores a branch DELETE, whose all-zero local sha deploys nothing', () => {
    const res = run(['check'], `(delete) ${'0'.repeat(40)} refs/heads/main ${SHA_A}\n`)

    expect(res.status).toBe(0)
    expect(tickets()).toHaveLength(0)
  })

  it('honours the emergency override', () => {
    seed(1, SHA_A)
    expect(check(SHA_B, { AF_SKIP_PUSH_QUEUE: '1' }).status).toBe(0)
  })
})

describe('push-queue — nothing skips the line', () => {
  it('keeps a blocked session in the SAME place across retries', () => {
    seed(1, SHA_A)

    const first = check(SHA_B)
    const seqAfterFirst = tickets().find((t) => t.sha === SHA_B)?.seq
    const second = check(SHA_B)
    const seqAfterSecond = tickets().find((t) => t.sha === SHA_B)?.seq

    expect(first.status).toBe(1)
    expect(second.status).toBe(1)
    expect(seqAfterFirst).toBe(seqAfterSecond)
    // Retrying must not re-queue you at the back — that is the starvation the
    // "retry in ~N min" build guard produced on its own.
    expect(tickets().filter((t) => t.sha === SHA_B)).toHaveLength(1)
  })

  it('serves a later arrival AFTER an earlier one, whoever pushes first', () => {
    // B arrives first and is blocked behind A; C arrives afterwards.
    seed(1, SHA_A)
    check(SHA_B)
    check(SHA_C)

    const seqB = tickets().find((t) => t.sha === SHA_B)?.seq as number
    const seqC = tickets().find((t) => t.sha === SHA_C)?.seq as number
    expect(seqB).toBeLessThan(seqC)

    // The head leaves. B — not C — is next, even though C tries first.
    run(['drop', String(1), '--reason=test'], '')

    expect(check(SHA_C).status).toBe(1)
    expect(check(SHA_B).status).toBe(0)
  })

  it('lets a rebind carry a place in line onto a new sha', () => {
    seed(1, SHA_A)
    seed(2, SHA_B)

    run(['rebind', `--from=${SHA_B}`, `--to=${SHA_C}`], '')

    const moved = tickets().find((t) => t.seq === 2)
    expect(moved).toMatchObject({ sha: SHA_C })
    // Still second, not sent to the back.
    expect(check(SHA_C).status).toBe(1)
  })
})

describe('push-queue — the line always moves', () => {
  it('reaps a ticket whose session went away, rather than deadlocking behind it', () => {
    seed(1, SHA_A, { heartbeatAt: Date.now() - 60 * 60_000 })

    const res = check(SHA_B)

    expect(res.status).toBe(0)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(false)
  })

  it('records every automatic release, so a vanished ticket is never silent', () => {
    seed(1, SHA_A, { heartbeatAt: Date.now() - 60 * 60_000 })
    check(SHA_B)

    const journal = readFileSync(join(queueDir, 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"event":"released"')
    expect(journal).toContain('heartbeat stale')
  })

  it('releases a waved-through ticket whose push never landed', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() - 60 * 60_000 })

    expect(check(SHA_B).status).toBe(0)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(false)
  })

  it('holds a waved-through ticket that is still inside its grace window', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() })

    expect(check(SHA_B).status).toBe(1)
  })

  /**
   * 🛑 The grace has to outlast pre-push-smoke.mjs, which takes up to 20 min.
   * At the old 10-min grace this ticket was released while its own push was
   * still inside the smoke run — freeing everyone behind it, moving `main`, and
   * bouncing the leader as non-fast-forward. Measured 2026-09-07: the same patch
   * lost six consecutive attempts in ~90 min and its patch-id never changed.
   *
   * 12 min is chosen to sit BETWEEN the short grace and the long one, so this
   * test is red if the long grace stops applying to a real run. A value inside
   * both, or outside both, would pass either way and prove nothing.
   *
   * ⚠ THE MARKER IS NOW WHAT EARNS THE LONG GRACE, so this test seeds one. Its
   * intent is unchanged and its companion below is the half that was missing:
   * the identical ticket WITHOUT a marker must be released, or the long grace is
   * still being charged to corpses and nothing has been fixed.
   */
  it('holds a ticket 12 minutes into a push while its smoke run is announced', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() - 12 * 60_000 })
    seedSmokeMarker(SHA_A)

    expect(check(SHA_B).status).toBe(1)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(true)
  })

  /**
   * 🛑 THE KNOWN POSITIVE FOR THE WHOLE FIX. Measured 2026-09-08: the queue was
   * 6 deep with the oldest ticket 37 min in line, past the ~25 min at which a
   * background wait lane is killed — so lanes died waiting, and each corpse then
   * held the head for the full 25 min grace. Nothing reached `origin/main`
   * between 08:04 and 12:45 on a lane that had landed 27 commits the day before.
   *
   * Same 12 minutes as the test above and the opposite verdict, with the marker
   * as the only difference between them. Both are needed: the pair is what
   * distinguishes "the short grace works" from "the long grace was deleted".
   */
  it('releases a ticket 12 minutes into a push with no smoke run announced', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() - 12 * 60_000 })

    expect(check(SHA_B).status).toBe(0)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(false)
    expect(readFileSync(join(queueDir, 'journal.jsonl'), 'utf8')).toContain('no smoke running')
  })

  /**
   * A marker keyed on someone else's commit must not rescue this ticket. Two
   * sessions are regularly inside the guards at once, and a marker that granted
   * the long grace to whoever happened to be at the head would restore the old
   * behaviour on any busy day — which is exactly when it matters.
   */
  it('ignores a smoke marker written for a different sha', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() - 12 * 60_000 })
    seedSmokeMarker(SHA_C)

    expect(check(SHA_B).status).toBe(0)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(false)
  })

  /**
   * A smoke killed hard enough to skip its own cleanup leaves its marker behind.
   * Without an age bound that corpse would grant the long grace indefinitely —
   * strictly worse than the behaviour being replaced, since it would never
   * expire rather than expiring at 25 min.
   */
  it('ignores a smoke marker older than the smoke could possibly run', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() - 12 * 60_000 })
    seedSmokeMarker(SHA_A, Date.now() - 90 * 60_000)

    expect(check(SHA_B).status).toBe(0)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(false)
  })

  /**
   * 🛑 The second half of the same bug, and the half a longer grace does NOT fix.
   * Nothing refreshes `heartbeatAt` between the wave-through and the end of the
   * push, so a healthy push's heartbeat ages exactly like an abandoned one. The
   * heartbeat branch used to run FIRST, which capped every push at HEARTBEAT_TTL
   * (15 min) no matter what the grace said — the shorter of two clocks always won.
   */
  it('does not reap a pushing ticket on its heartbeat, which nothing refreshes mid-push', () => {
    // `allowedAt` is NOW, so the grace cannot be what saves this ticket — only
    // the state check can. Dating it 12 min ago instead would conflate the two
    // halves of the fix and this test would go red for the other one's reason.
    seed(1, SHA_A, {
      state: 'pushing',
      allowedAt: Date.now(),
      heartbeatAt: Date.now() - 60 * 60_000,
    })

    expect(check(SHA_B).status).toBe(1)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(true)
  })

  /**
   * The control for the exemption above, so it cannot become "a pushing ticket
   * lives forever". A ticket claiming to push with no `allowedAt` is malformed —
   * hand-edited, or written by an older version — and must still be reaped by the
   * heartbeat rule rather than trusted indefinitely.
   */
  it('still reaps a ticket that claims to be pushing but has no allowedAt', () => {
    seed(1, SHA_A, { state: 'pushing', heartbeatAt: Date.now() - 60 * 60_000 })

    expect(check(SHA_B).status).toBe(0)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(false)
  })
})

describe('push-queue — the pusher gate', () => {
  const claimPusher = (token = 'tok-123') =>
    writeFileSync(
      join(queueDir, 'pusher.json'),
      JSON.stringify({ name: 'session-61', ref: 'allfantasy-v2-main-61', token, since: Date.now() }),
    )

  it('refuses a session that is not the designated pusher, with exit 1', () => {
    claimPusher()

    const res = check(SHA_A)

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('session-61 is the designated pusher')
    // Gate runs BEFORE a ticket is taken: a session that is not pushing today
    // should not be holding a place in the line either.
    expect(tickets()).toHaveLength(0)
  })

  it('tells a blocked session how to hand the work over, not just that it lost', () => {
    claimPusher()
    const res = check(SHA_A)
    expect(res.stderr).toContain('allfantasy-v2-main-61')
    expect(res.stderr).toContain('ATTESTATION')
  })

  it('lets the pusher through, and it still has to queue', () => {
    claimPusher()
    seed(1, SHA_B)

    const res = check(SHA_A, { AF_PUSH_TOKEN: 'tok-123' })

    // Past the gate, but second in line — the gate does not skip the queue.
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('it is not your turn')
  })

  it('applies no gate at all when nobody holds the role', () => {
    expect(check(SHA_A).status).toBe(0)
  })

  it('applies no gate when the pusher file is corrupt, rather than blocking everyone', () => {
    writeFileSync(join(queueDir, 'pusher.json'), '{ half-written')

    expect(check(SHA_A).status).toBe(0)
  })
})

describe('push-queue — the pusher lock has a heartbeat', () => {
  const writePusher = (extra: Record<string, unknown> = {}) =>
    writeFileSync(
      join(queueDir, 'pusher.json'),
      JSON.stringify({
        name: 'session-61',
        ref: 'allfantasy-v2-main-61',
        token: 'tok-123',
        since: Date.now(),
        heartbeatAt: Date.now(),
        ...extra,
      }),
    )
  const pusherFileExists = () => existsSync(join(queueDir, 'pusher.json'))
  const STALE = { heartbeatAt: Date.now() - 90 * 60_000 }

  it('expires a lock nobody has refreshed, so a vanished pusher cannot block forever', () => {
    writePusher(STALE)

    const res = check(SHA_A)

    expect(res.status).toBe(0) // gate is gone
    expect(pusherFileExists()).toBe(false)
    expect(readFileSync(join(queueDir, 'journal.jsonl'), 'utf8')).toContain('"event":"pusher-expired"')
  })

  it('keeps honouring a lock whose heartbeat is fresh', () => {
    writePusher()

    expect(check(SHA_A).status).toBe(1)
    expect(pusherFileExists()).toBe(true)
  })

  it('refreshes the heartbeat when the token holder pushes', () => {
    const old = Date.now() - 20 * 60_000
    writePusher({ heartbeatAt: old })

    check(SHA_A, { AF_PUSH_TOKEN: 'tok-123' })

    const after = JSON.parse(readFileSync(join(queueDir, 'pusher.json'), 'utf8'))
    expect(after.heartbeatAt).toBeGreaterThan(old)
  })

  it('does NOT refresh on a push from someone who is not the holder', () => {
    const old = Date.now() - 20 * 60_000
    writePusher({ heartbeatAt: old })

    check(SHA_A) // no token

    const after = JSON.parse(readFileSync(join(queueDir, 'pusher.json'), 'utf8'))
    expect(after.heartbeatAt).toBe(old)
  })

  // 🛑 THE KNOWN POSITIVE FOR THE INCIDENT THIS EXISTS TO PREVENT: on
  // 2026-08-30 a peer released a lock held by a session that was mid-batch,
  // because the holder's NAME had stopped resolving. A live lock must refuse.
  it('refuses --release from a session that does not hold a LIVE lock', () => {
    writePusher()

    const res = run(['pusher', '--release'], '')

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('the lock is LIVE')
    expect(pusherFileExists()).toBe(true)
  })

  it('lets the token holder release their own lock', () => {
    writePusher()

    const res = run(['pusher', '--release'], '', { AF_PUSH_TOKEN: 'tok-123' })

    expect(res.status).toBe(0)
    expect(pusherFileExists()).toBe(false)
    expect(readFileSync(join(queueDir, 'journal.jsonl'), 'utf8')).toContain('released by its holder')
  })

  it('lets anyone release a lock that has already gone stale', () => {
    writePusher(STALE)

    const res = run(['pusher', '--release'], '')

    expect(res.status).toBe(0)
    expect(pusherFileExists()).toBe(false)
  })

  it('allows --force, and records that it was forced', () => {
    writePusher()

    const res = run(['pusher', '--release', '--force'], '')

    expect(res.status).toBe(0)
    expect(pusherFileExists()).toBe(false)
    expect(readFileSync(join(queueDir, 'journal.jsonl'), 'utf8')).toContain('FORCED')
  })

  it('refuses a claim that would take the role from a live holder', () => {
    writePusher()

    const res = run(['pusher', '--claim', 'someone-else'], '')

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('already holds the pusher role')
    expect(JSON.parse(readFileSync(join(queueDir, 'pusher.json'), 'utf8')).name).toBe('session-61')
  })

  it('allows a claim once the previous lock has expired', () => {
    writePusher(STALE)

    const res = run(['pusher', '--claim', 'someone-else'], '')

    expect(res.status).toBe(0)
    expect(JSON.parse(readFileSync(join(queueDir, 'pusher.json'), 'utf8')).name).toBe('someone-else')
  })

  // 🛑 THE DEFECT THE FIRST VERSION SHIPPED WITH, AS A KNOWN POSITIVE.
  // Refreshing only inside `check` meant the heartbeat ticked only when the
  // pusher pushed — so a pusher waiting on a long check went stale during
  // exactly the window the TTL exists to cover. It expired a live lock after
  // 92 minutes on its first real outing.
  it('treats ANY command from the token holder as a heartbeat, not just a push', () => {
    const old = Date.now() - 30 * 60_000
    writePusher({ heartbeatAt: old })

    run(['status'], '', { AF_PUSH_TOKEN: 'tok-123' })

    const after = JSON.parse(readFileSync(join(queueDir, 'pusher.json'), 'utf8'))
    expect(after.heartbeatAt).toBeGreaterThan(old)
  })

  it('does not let a NON-holder refresh the lock by running commands', () => {
    const old = Date.now() - 30 * 60_000
    writePusher({ heartbeatAt: old })

    run(['status'], '') // no token

    const after = JSON.parse(readFileSync(join(queueDir, 'pusher.json'), 'utf8'))
    expect(after.heartbeatAt).toBe(old)
  })

  it('does not resurrect an ALREADY-stale lock by running a command', () => {
    writePusher(STALE)

    run(['status'], '', { AF_PUSH_TOKEN: 'tok-123' })

    // Expired is expired — a late heartbeat must not undo it.
    expect(existsSync(join(queueDir, 'pusher.json'))).toBe(false)
  })

  it('stamps a heartbeat on a fresh claim, so it is not instantly stale', () => {
    const res = run(['pusher', '--claim', 'me'], '')

    expect(res.status).toBe(0)
    const p = JSON.parse(readFileSync(join(queueDir, 'pusher.json'), 'utf8'))
    expect(typeof p.heartbeatAt).toBe('number')
    expect(Date.now() - p.heartbeatAt).toBeLessThan(60_000)
  })
})

describe('push-queue — a ticket survives a REBASE renaming its commit', () => {
  // 🛑 THE POSITIVE CONTROL FOR THE REBIND, ON THE PAIR THAT ACTUALLY HAPPENED.
  // A peer's rebase renamed cc8593229 → e0e444030 in this repo on 2026-08-30.
  // A rebase produces a SIBLING, not a descendant, so `merge-base --is-ancestor`
  // answers rc=1 in BOTH directions and an ancestor-only rebind is blind to the
  // exact case it was added for. Their patch-ids are identical. A rebind that
  // silently declines is indistinguishable from having no rebind at all, so this
  // asserts the ancestor check really is blind AND that the ticket moves anyway.
  const OLD = 'cc8593229'
  const NEW = 'e0e444030'
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const reachable = (sha: string) =>
    spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0

  it.runIf(reachable(OLD) && reachable(NEW))(
    'neither commit is an ancestor of the other — the ancestor test alone cannot see this',
    () => {
      expect(spawnSync('git', ['merge-base', '--is-ancestor', OLD, NEW]).status).toBe(1)
      expect(spawnSync('git', ['merge-base', '--is-ancestor', NEW, OLD]).status).toBe(1)
    },
  )

  it.runIf(reachable(OLD) && reachable(NEW))('carries the ticket forward anyway, on patch-id', () => {
    const oldFull = execFileSync('git', ['rev-parse', OLD], { encoding: 'utf8' }).trim()
    const newFull = execFileSync('git', ['rev-parse', NEW], { encoding: 'utf8' }).trim()
    seed(1, SHA_A) // someone genuinely ahead
    seed(2, oldFull, { worktree })

    const res = check(newFull)

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('position      2 of 2') // still second, not sent to the back
    expect(tickets()).toHaveLength(2)
    expect(tickets().find((t) => t.seq === 2)).toMatchObject({ sha: newFull })
    expect(readFileSync(join(queueDir, 'journal.jsonl'), 'utf8')).toContain('patch-id match')
  })

  it('does not treat two uncomputable patch-ids as a match', () => {
    // Fabricated SHAs have no patch-id at all; null must never equal null, or
    // one session's place in line gets handed to another.
    seed(1, SHA_B, { worktree })

    check(SHA_C)

    expect(tickets()).toHaveLength(2)
    expect(tickets().find((t) => t.seq === 1)).toMatchObject({ sha: SHA_B })
  })
})

describe('push-queue — a ticket survives its sha being rewritten', () => {
  // Real commits, because `merge-base --is-ancestor` needs a real graph.
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  /*
   * 🛑 `HEAD~1` DOES NOT EXIST IN A SHALLOW CLONE, AND THIS THREW AT DESCRIBE
   * SCOPE. `actions/checkout` fetches depth 1 by default, so `git rev-parse
   * HEAD~1` exits non-zero, `execFileSync` throws while the suite is being
   * COLLECTED, and the whole file dies before any `it` registers -- reported as
   * a file-level failure, not a test failure, which is why it read as a
   * regression in something unrelated to the queue.
   *
   * The workflow now checks out with `fetch-depth: 2` so the parent is really
   * there and these assertions really run. This guard is the belt to that
   * braces: it must never SILENTLY skip on the runner, so the two `it`s below
   * stay unconditional and fail loudly if the parent is missing -- a check that
   * quietly disappears is indistinguishable from one that passes.
   */
  const parentOf = (rev: string): string | null => {
    const r = spawnSync('git', ['rev-parse', '--verify', `${rev}^{commit}`], { encoding: 'utf8' })
    return r.status === 0 ? r.stdout.trim() : null
  }
  const parent = parentOf('HEAD~1') ?? ''
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

  it('has a parent commit to rewrite onto -- a shallow checkout must go red, not silently skip', () => {
    expect(parent).not.toBe('')
  })

  it('carries a place in line onto a descendant sha instead of going to the back', () => {
    seed(1, SHA_A) // someone genuinely ahead
    seed(2, parent, { worktree })

    const res = check(head)

    // Still #2 — an amend or a peer's rebase must not cost a place in line.
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('position      2 of 2')
    expect(tickets()).toHaveLength(2)
    expect(tickets().find((t) => t.seq === 2)).toMatchObject({ sha: head })
    // And pin the OTHER branch: a genuine descendant must be caught by the
    // ancestry test, not by patch-id. Without this the ancestor half could be
    // dead code and the suite would stay green.
    expect(readFileSync(join(queueDir, 'journal.jsonl'), 'utf8')).toContain('descendant of the held sha')
  })

  it('does not let one session hold two live tickets and take two turns', () => {
    seed(1, parent, { worktree })

    check(head)

    expect(tickets()).toHaveLength(1)
  })

  it('leaves a DIFFERENT worktree’s ticket alone, even on an ancestor sha', () => {
    seed(1, parent, { worktree: `${worktree}-someone-else` })

    check(head)

    // A new ticket at the back; the peer keeps theirs.
    expect(tickets()).toHaveLength(2)
    expect(tickets().find((t) => t.seq === 1)).toMatchObject({ sha: parent })
  })
})

describe('push-queue — it fails open', () => {
  it('allows the push when a ticket is corrupt, rather than guessing at the order', () => {
    seed(1, SHA_A)
    writeFileSync(join(queueDir, '000002.json'), '{ this is not json')

    const res = check(SHA_B)

    expect(res.status).toBe(0)
    expect(res.stderr).toContain('failing open')
  })

  it('allows the push when the queue directory cannot be created', () => {
    // A plain file where the directory should be: `mkdir -p` fails with EEXIST
    // on every platform, which an invalid-character path does not.
    const blocked = join(queueDir, 'not-a-directory')
    writeFileSync(blocked, 'occupied')

    const res = run(['check'], mainPayload(SHA_A), { AF_PUSH_QUEUE_DIR: blocked })

    expect(res.status).toBe(0)
    expect(res.stderr).toContain('failing open')
  })
})

/**
 * 🛑 THE VERDICT MUST BE ABOUT THE SHA THAT WAS PUSHED, NOT ABOUT `HEAD`.
 *
 * `cmdPush` pins HEAD into its own refspec, which is right — HEAD moves under a session here and
 * one session pushed three peers' commits that way. But the LANDING convention requires the
 * opposite shape: you cherry-pick onto `origin/main` in a detached worktree, so the tip you push
 * is by construction NOT your HEAD, and you pass the refspec yourself. On that path the wrapper
 * sent one sha and verified another.
 *
 * Observed 2026-08-31 landing a five-commit batch. The push succeeded and the wrapper said:
 *
 *     ⚠ push did NOT land — origin/main is 2eaab62b8, not cc7dcd142
 *
 * — which is the wrapper stating that origin/main IS the requested commit, and calling it a
 * failure. ⚠ THE COST IS A DUPLICATE PRODUCTION BUILD: told a push failed, the next thing anyone
 * does is push again, which is the exact spend this queue exists to remove.
 *
 * This runs a REAL push against a REAL bare remote, because the bug is in the agreement between
 * what git did and what the wrapper reported — mocking either side would assume the thing under
 * test.
 */
describe('push — a supplied refspec is verified against the sha it names', () => {
  let repoRoot: string

  function git(args: string[], cwd: string) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
    return (r.stdout ?? '').trim()
  }

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'af-pq-repo-'))
    const remote = join(repoRoot, 'remote.git')
    const work = join(repoRoot, 'work')
    execFileSync('git', ['init', '--quiet', '--bare', remote])
    execFileSync('git', ['init', '--quiet', '-b', 'main', work])
    for (const [k, v] of [
      ['user.name', 't'],
      ['user.email', 't@t'],
      ['commit.gpgsign', 'false'],
    ]) {
      execFileSync('git', ['config', k, v], { cwd: work })
    }
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: work })
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('reports a landed push as success when the refspec names a commit that is not HEAD', () => {
    const work = join(repoRoot, 'work')
    const commit = (name: string, msg: string) => {
      writeFileSync(join(work, name), msg)
      execFileSync('git', ['add', name], { cwd: work })
      execFileSync('git', ['commit', '--quiet', '-m', msg], { cwd: work })
      return git(['rev-parse', 'HEAD'], work)
    }

    commit('a.txt', 'base')
    execFileSync('git', ['push', '--quiet', 'origin', 'main'], { cwd: work })

    // The commit we intend to land — reachable, but not HEAD.
    execFileSync('git', ['checkout', '--quiet', '-b', 'side'], { cwd: work })
    const target = commit('b.txt', 'the commit to land')

    // HEAD then moves somewhere else, exactly as it does in the shared checkout.
    execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: work })
    const head = commit('c.txt', "somebody else's work")

    // If these ever coincide the case proves nothing — assert the setup before the behaviour.
    expect(target).not.toBe(head)

    const res = spawnSync('node', [SCRIPT, 'push', 'origin', `${target}:refs/heads/main`], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        AF_PUSH_QUEUE_DIR: queueDir,
        AF_SKIP_PREPUSH_HOOK: '1',
        AF_ALLOW_CONCURRENT_PUSH: '1',
      },
    })

    // Ground truth first: if the push did not actually land, the wrapper being wrong is not the
    // finding and this assertion says so before the interesting one runs.
    expect(git(['ls-remote', 'origin', 'refs/heads/main'], work).split(/\s/)[0]).toBe(target)

    expect(res.stdout).toContain(`origin/main is now ${target.slice(0, 9)}`)
    expect(res.stderr).not.toContain('did NOT land')
    expect(res.status).toBe(0)
  })
})

describe('push-queue — a live lock must not advertise a dead address', () => {
  /**
   * 🛑 THE DEFECT THIS CLOSES, AND WHY THE PREVIOUS FIX DID NOT COVER IT.
   *
   * b3b05199d stopped peers RELEASING a live lock whose recorded name had stopped
   * resolving: liveness became something measured (a heartbeat) rather than inferred
   * from whether a name still appears in ListAgents. Correct, and it held.
   *
   * It left the ADDRESS alone. `name`/`ref` are written once at --claim and carried
   * forward verbatim by every heartbeat, so a holder who is renamed keeps advertising
   * the name they claimed under — forever. On 2026-09-02 three sessions in a row read
   * `reach them at allfantasy-v2-main-b8`, had SendMessage refused, and had nowhere to
   * go: the holder was alive and pushing, so the self-clearing valve correctly never
   * fired and there was nothing to wait for.
   *
   * ⚠ THAT IS STRICTLY WORSE THAN THE BUG THAT WAS FIXED. A stale lock resolves itself.
   * A stale address on a LIVE lock has no expiry, because the thing that would expire
   * is exactly the thing that is healthy.
   */
  const claimAt = (over: Record<string, unknown> = {}) =>
    writeFileSync(
      join(queueDir, 'pusher.json'),
      JSON.stringify({
        name: 'session-b8',
        ref: 'allfantasy-v2-main-b8',
        token: 'tok-123',
        since: Date.now(),
        heartbeatAt: Date.now(),
        nameAt: Date.now(),
        ...over,
      }),
    )
  const pusherFile = () => JSON.parse(readFileSync(join(queueDir, 'pusher.json'), 'utf8')) as Record<string, unknown>

  it('stamps nameAt on --claim, so the address has an age at all', () => {
    const res = run(['pusher', '--claim', 'session-aaa', '--ref', 'session-aaa'], '')
    expect(res.status).toBe(0)
    expect(typeof pusherFile().nameAt).toBe('number')
  })

  it('lets the TOKEN HOLDER re-advertise after a rename', () => {
    claimAt()
    const res = run(['pusher', '--heartbeat', '--as', 'session-36'], '', { AF_PUSH_TOKEN: 'tok-123' })
    expect(res.status).toBe(0)
    expect(pusherFile().name).toBe('session-36')
    expect(pusherFile().ref).toBe('session-36')
  })

  /*
   * 🛑 THE SECURITY PROPERTY. If anyone could re-advertise, a session could point the
   * address at itself and harvest every blocked peer's handover. The token is the
   * identity here; the name is only a hint for humans.
   */
  it('refuses a rename from a session that does not hold the token', () => {
    claimAt()
    const res = run(['pusher', '--heartbeat', '--as', 'session-intruder'], '')
    expect(res.stdout).toContain('not your lock')
    expect(pusherFile().name).toBe('session-b8')
  })

  it('re-advertises automatically on the holder’s own gated push, via AF_PUSH_NAME', () => {
    // Self-healing is the point: a working pusher pushes, so the address a blocked
    // peer reads is at most one push old without anyone remembering a command.
    claimAt()
    check(SHA_A, { AF_PUSH_TOKEN: 'tok-123', AF_PUSH_NAME: 'session-36' })
    expect(pusherFile().name).toBe('session-36')
  })

  it('does NOT let a blocked non-holder rewrite the address with AF_PUSH_NAME', () => {
    claimAt()
    const res = check(SHA_A, { AF_PUSH_NAME: 'session-intruder' })
    expect(res.status).toBe(1)
    expect(pusherFile().name).toBe('session-b8')
  })

  /*
   * The positive control for the whole change: a LIVE heartbeat with an OLD address is
   * exactly the state three sessions were stuck in, and it previously produced a
   * confident "reach them at <dead name>" with nothing to distinguish it from a good one.
   */
  it('warns when the address is old even though the heartbeat is fresh', () => {
    claimAt({ heartbeatAt: Date.now(), nameAt: Date.now() - 30 * 60 * 1000 })
    const res = run(['pusher'], '')
    expect(res.stdout).toContain('address confirmed 30 min ago')
    expect(res.stdout).toContain('MAY NO LONGER RESOLVE')
    // The step that was missing: what to DO, not only what not to conclude.
    expect(res.stdout).toContain('--heartbeat --as')
    expect(res.stdout).toContain('Do NOT')
  })

  it('stays quiet when the address is fresh, so the warning keeps its meaning', () => {
    claimAt()
    expect(run(['pusher'], '').stdout).not.toContain('MAY NO LONGER RESOLVE')
  })

  /* A lock claimed before nameAt existed must not crash or read as brand new. */
  it('falls back to `since` for a lock written before nameAt existed', () => {
    claimAt({ since: Date.now() - 8 * 60 * 1000, nameAt: undefined })
    const res = run(['pusher'], '')
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('address confirmed 8 min ago')
  })
})

/**
 * 🛑 `rebind` moved OTHER SESSIONS' tickets, and the default victim was the head
 * of the line. Nine sessions share one checkout, so there is no such thing as a
 * safe implicit "my ticket". Every test here asserts the ticket is UNCHANGED on
 * the refusal path — an exit code alone would not catch a command that refuses
 * loudly and mutates anyway.
 */
describe('push-queue — rebind cannot touch a ticket that is not yours', () => {
  const ticketOf = (seq: number) =>
    JSON.parse(readFileSync(join(queueDir, `${String(seq).padStart(6, '0')}.json`), 'utf8'))

  it('refuses with no --from when the ticket belongs to another worktree, and moves nothing', () => {
    // seed() writes worktree: '' — i.e. NOT this checkout. Before the fix this
    // fell through to tickets[0] and rebound the head of the line.
    seed(1, SHA_A)

    const res = run(['rebind', `--to=${SHA_B}`], '')

    expect(res.status).toBe(1)
    expect(ticketOf(1).sha).toBe(SHA_A)
  })

  it('refuses with no --to, because any unrecognised flag used to rebind to HEAD', () => {
    seed(1, SHA_A, { worktree: process.cwd() })

    // There is no --help; this is exactly the invocation that mutated the queue.
    const res = run(['rebind', '--help'], '')

    expect(res.status).toBe(1)
    expect(ticketOf(1).sha).toBe(SHA_A)
  })

  it('refuses when this worktree holds more than one ticket, rather than guessing', () => {
    seed(1, SHA_A, { worktree: process.cwd() })
    seed(2, SHA_B, { worktree: process.cwd() })

    const res = run(['rebind', `--to=${SHA_C}`], '')

    expect(res.status).toBe(1)
    expect(ticketOf(1).sha).toBe(SHA_A)
    expect(ticketOf(2).sha).toBe(SHA_B)
  })

  it('still rebinds the ticket named by --from, keeping its place', () => {
    seed(1, SHA_A)
    seed(2, SHA_B)

    const res = run(['rebind', `--from=${SHA_B}`, `--to=${SHA_C}`], '')

    expect(res.status ?? 0).toBe(0)
    expect(ticketOf(2).sha).toBe(SHA_C)
    expect(ticketOf(2).seq).toBe(2) // place kept
    expect(ticketOf(1).sha).toBe(SHA_A) // the other ticket untouched
  })

  it('rebinds without --from when exactly one ticket is this worktree’s', () => {
    seed(1, SHA_A, { worktree: process.cwd() })

    const res = run(['rebind', `--to=${SHA_B}`], '')

    expect(res.status ?? 0).toBe(0)
    expect(ticketOf(1).sha).toBe(SHA_B)
  })
})

/**
 * 🛑 THE TWO SCRIPTS MUST AGREE ON WHERE THE MARKER LIVES, AND DISAGREEING IS
 * SILENT IN THE DANGEROUS DIRECTION.
 *
 * `pre-push-smoke.mjs` writes the marker; `push-queue.mjs` reads it. If they
 * ever compute different paths, the write still succeeds, the smoke still runs,
 * and the queue simply never sees a marker — so every real smoke run falls back
 * to the SHORT grace and expires mid-compile. That is the six-lost-landings
 * starvation restored, with no error anywhere and every test above still green,
 * because each one seeds the marker itself rather than making the smoke write it.
 *
 * ⚠ THIS IS A COARSE DRIFT GUARD, NOT PROOF. It compares the path ingredients as
 * they appear in each source — it would catch a rename of the directory or a
 * dropped env override in one file only, which is the realistic way these two
 * drift. It cannot catch a difference the strings do not show. Driving the real
 * smoke end-to-end would need a git worktree, a node_modules link and a cold
 * compile to assert one arithmetic branch; the honest trade is a cheap guard
 * that names its own limit.
 */
describe('push-queue — the smoke marker contract', () => {
  const smokeSrc = readFileSync(join(process.cwd(), 'scripts', 'pre-push-smoke.mjs'), 'utf8')
  const queueSrc = readFileSync(join(process.cwd(), 'scripts', 'push-queue.mjs'), 'utf8')

  it('both scripts name the same marker directory', () => {
    expect(smokeSrc).toContain("'smoke-active'")
    expect(queueSrc).toContain("'smoke-active'")
  })

  it('both scripts key the marker file on the sha', () => {
    expect(smokeSrc).toContain('`${sha}.json`')
    expect(queueSrc).toContain('`${sha}.json`')
  })

  /**
   * The override exists so this suite can point both at a temp dir. A smoke that
   * ignored it would write into the real queue during a test run — and, worse,
   * would prove nothing about the path used in production.
   */
  it('both scripts honour the AF_PUSH_QUEUE_DIR override', () => {
    expect(smokeSrc).toContain('AF_PUSH_QUEUE_DIR')
    expect(queueSrc).toContain('AF_PUSH_QUEUE_DIR')
  })

  /**
   * The marker is only worth writing if the smoke refuses to run without it.
   * Were it to fail open here, an unannounced run would get the short grace —
   * the exact regression this whole mechanism exists to prevent.
   */
  it('the smoke skips rather than running unannounced', () => {
    expect(smokeSrc).toContain('skipping rather than running unannounced')
  })
})

/**
 * 🛑 A TICKET IS WAITING FOR ITS WORK TO BE ON MAIN, NOT FOR ITS SHA TO BE THE TIP.
 *
 * The tip is only the tip until the next push lands on it. Between a push
 * finishing and the next reconcile, any peer can land — and the exact-sha test
 * then answers "no" forever about a commit sitting on `origin/main`, so the
 * ticket holds the HEAD OF THE LINE until its grace expires. On the 7-deep queue
 * of 2026-09-08 that compounds with every single landing.
 *
 * These name the remote tip through `AF_PUSH_QUEUE_REMOTE_SHA` rather than
 * reaching the network, so a flaky `ls-remote` is never what decides whether the
 * queue blocks — the same reason `AF_PUSH_QUEUE_NO_REMOTE` exists for the rest
 * of the file.
 */
describe('push-queue — a ticket whose work is already on main', () => {
  /**
   * 🛑 THESE TWO USED TO READ `origin/main` AND `origin/main~3` OUT OF THIS
   * CHECKOUT, AND THAT IS WHY THEY PASSED HERE AND FAILED IN CI FOR WEEKS.
   *
   * `actions/checkout` fetches one ref at depth 1 and leaves the workspace on a
   * detached merge commit: there is no `origin/main` remote-tracking ref to
   * resolve, and no depth for `~3` even if there were. The failure was
   * `fatal: ambiguous argument 'origin/main'` — an environment assumption, not a
   * defect in the queue, which is the most expensive kind of red because it
   * looks like a real regression on every unrelated PR.
   *
   * ⚠ AND A `skipIf` WOULD HAVE BEEN THE WRONG FIX. It would have made the suite
   * green by never running the ancestry logic in the one place that gates
   * merges. The script does not actually need `origin/main` to exist — it is
   * handed the tip through `AF_PUSH_QUEUE_REMOTE_SHA` and only needs the two
   * OBJECTS present locally for `merge-base --is-ancestor` — so a four-commit
   * throwaway repo reproduces the real thing and depends on nothing ambient.
   */
  let repo: string
  let tip: string
  let mine: string

  const g = (args: string[], cwd: string) =>
    execFileSync('git', args, { encoding: 'utf8', cwd }).trim()

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'af-push-queue-repo-'))
    // `-c` rather than `git config`, so a CI runner with no identity — and one
    // with commit.gpgsign on — both work without touching global state.
    const id = [
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=test',
      '-c',
      'commit.gpgsign=false',
    ]
    g(['init', '-q', '-b', 'main'], repo)
    for (let i = 0; i < 4; i++) {
      g([...id, 'commit', '-q', '--allow-empty', '-m', `c${i}`], repo)
    }
    tip = g(['rev-parse', 'HEAD'], repo)
    mine = g(['rev-parse', 'HEAD~3'], repo)
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  /**
   * `allowedAt` is NOW, so the grace cannot be what releases this — only the
   * landed check can. Dating it in the past would conflate the two and this test
   * would go green for the other one's reason.
   */
  it('releases a pushing ticket whose commit is an ancestor of the tip, not the tip itself', () => {
    expect(mine).not.toBe(tip) // the whole point: mine is ON main but is not the tip

    seed(1, mine, { state: 'pushing', allowedAt: Date.now() })

    const res = check(SHA_B, { AF_PUSH_QUEUE_NO_REMOTE: '0', AF_PUSH_QUEUE_REMOTE_SHA: tip }, repo)

    expect(res.status).toBe(0)
    expect(tickets().some((t) => t.sha === mine)).toBe(false)
    expect(readFileSync(join(queueDir, 'journal.jsonl'), 'utf8')).toContain('landed on origin/main')
  })

  /**
   * The control, so the release above cannot become "any pushing ticket is
   * released once a remote sha is known". A sha that is not on main at all must
   * still be held — and note it is held for the RIGHT reason: `merge-base
   * --is-ancestor` on a nonexistent object exits neither 0 nor 1, which this file
   * treats as "not a verdict" rather than as "no".
   */
  it('holds a pushing ticket whose commit is not on origin/main', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() })

    const res = check(SHA_B, { AF_PUSH_QUEUE_NO_REMOTE: '0', AF_PUSH_QUEUE_REMOTE_SHA: tip }, repo)

    expect(res.status).toBe(1)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(true)
  })
})

/**
 * 🛑 AN UNANNOUNCED SMOKE LOOKS EXACTLY LIKE NO SMOKE, AND KILLING ONE AT 10
 * MINUTES IS THE REGRESSION THE LONG GRACE EXISTS TO PREVENT.
 *
 * The pre-push hook resolves scripts from `$root/scripts` and only falls back to
 * the primary checkout when the file is ABSENT — so a linked worktree on an older
 * commit runs its OWN older `pre-push-smoke.mjs`, which writes no marker. For as
 * long as any such worktree exists, real 20-minute compiles will be unannounced.
 *
 * Caught in production, not in review: on 2026-09-08 `#272` was released as
 * "never landed (no smoke running, short grace)" 12 minutes into a push whose
 * commit is now `origin/main` — its push was still in flight and the marker
 * scheme could not see it.
 *
 * A running compiler is the evidence that separates the two cases. These pin
 * BOTH halves, because the deferral is only safe if it is bounded.
 */
describe('push-queue — an unannounced smoke still gets the long grace', () => {
  it('holds a 12-minute unmarked push while a compile is in flight', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() - 12 * 60_000 })

    const res = check(SHA_B, { AF_PUSH_QUEUE_ASSUME_TSC: '1' })

    expect(res.status).toBe(1)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(true)
  })

  /**
   * The bound, and the reason the deferral cannot become "a pushing ticket lives
   * as long as anyone on the box is compiling". Past PUSH_GRACE_MS the ticket
   * goes regardless of what the process table says — this repo runs ~9 sessions
   * and something is almost always compiling.
   */
  it('still releases past the FULL grace even with a compile in flight', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() - 26 * 60_000 })

    const res = check(SHA_B, { AF_PUSH_QUEUE_ASSUME_TSC: '1' })

    expect(res.status).toBe(0)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(false)
    expect(readFileSync(join(queueDir, 'journal.jsonl'), 'utf8')).toContain(
      'no smoke ever announced',
    )
  })

  /**
   * "Cannot tell" must behave like "a compile is running", never like "none is".
   * An unreadable process table is not evidence that it is safe to shorten a
   * grace — the same three-valued discipline this file applies to
   * `merge-base --is-ancestor` and that CLAUDE.md applies to a `timeout`'s 124.
   */
  it('keeps the long grace when the process table cannot be read', () => {
    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() - 12 * 60_000 })

    // An unset override on a non-win32 CI box returns null from the probe; on
    // win32 an unparseable count does the same. Either way: not a verdict.
    const res = check(SHA_B, { AF_PUSH_QUEUE_ASSUME_TSC: 'unreadable' })

    expect(res.status).toBe(1)
    expect(tickets().some((t) => t.sha === SHA_A)).toBe(true)
  })
})

describe('push-queue — a ticket is REFUSED when the push would add nothing', () => {
  /**
   * 🛑 THE QUEUE'S DEPTH WAS MOSTLY NOT REAL WORK. Audited 2026-09-11: 6 of 11
   * live tickets were already upstream — three copies of one docs commit under
   * renamed shas, plus two whose patch-id was on `main` hours earlier. The
   * refusal has to land at TICKET time; refusing at the head of the line is a
   * correct answer delivered forty minutes late, and does not stop the ticket
   * occupying a place meanwhile. So every case here asserts BOTH the exit status
   * AND that no ticket file was written.
   *
   * ⚠ THE `stranding` CASE IS THE REASON THIS IS NOT A ONE-LINER, and it must
   * never be "simplified" away. A ticket is keyed on the TIP, and a tip's
   * patch-id is only its top commit's — so testing "the tip is already upstream"
   * refuses a tip of [new commit, duplicate on top] and the new commit never
   * lands. No conflict, no error, just a push nobody let through.
   */
  let repo: string
  let main: string
  let dupOfLanded: string
  let brandNew: string
  let strandingTip: string
  let containedSha: string

  const g = (args: string[], cwd: string) =>
    execFileSync('git', args, { encoding: 'utf8', cwd }).trim()
  const patchId = (sha: string, cwd: string) => {
    const show = execFileSync('git', ['show', sha, '--format=', '--patch'], { encoding: 'utf8', cwd })
    return execFileSync('git', ['patch-id', '--stable'], { input: show, encoding: 'utf8', cwd })
      .trim()
      .split(/\s+/)[0]
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'af-push-queue-dup-'))
    const id = ['-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'commit.gpgsign=false']
    const commit = (file: string, msg: string) => {
      writeFileSync(join(repo, file), `${file}\n`)
      g([...id, 'add', file], repo)
      g([...id, 'commit', '-q', '-m', msg], repo)
      return g(['rev-parse', 'HEAD'], repo)
    }

    g(['init', '-q', '-b', 'main'], repo)
    const c0 = commit('base.txt', 'c0')
    // The ORIGINAL feature commit, authored off c0 and never pushed from here.
    const original = commit('f.txt', 'feat: the feature')

    // main carries a CHERRY-PICKED COPY of it — same patch, different sha.
    g(['checkout', '-q', '-B', 'mainline', c0], repo)
    commit('one.txt', 'c1')
    g([...id, 'cherry-pick', original], repo)
    main = g(['rev-parse', 'HEAD'], repo)
    containedSha = c0
    dupOfLanded = original

    g(['checkout', '-q', '-B', 'newonly', c0], repo)
    brandNew = commit('n.txt', 'feat: genuinely new')

    g(['checkout', '-q', '-B', 'stranding', c0], repo)
    commit('n2.txt', 'feat: new, and would be stranded')
    g([...id, 'cherry-pick', original], repo)
    strandingTip = g(['rev-parse', 'HEAD'], repo)
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  const remote = (extra: Record<string, string> = {}) => ({
    AF_PUSH_QUEUE_NO_REMOTE: '0',
    AF_PUSH_QUEUE_REMOTE_SHA: main,
    ...extra,
  })

  it('the fixture is real: the copy on main is a RENAME, not the same commit', () => {
    // Without this the duplicate case could pass for the trivial reason that the
    // two shas are equal, which is not the case the guard exists for.
    expect(dupOfLanded).not.toBe(main)
    expect(patchId(dupOfLanded, repo)).toBe(patchId(main, repo))
    expect(spawnSync('git', ['merge-base', '--is-ancestor', dupOfLanded, main], { cwd: repo }).status).toBe(1)
  })

  it('REFUSES a sha already contained in main, and takes no ticket', () => {
    const res = check(containedSha, remote(), repo)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('would add nothing')
    expect(tickets()).toHaveLength(0)
  })

  it('REFUSES a cherry-picked duplicate matched by patch-id, and takes no ticket', () => {
    const res = check(dupOfLanded, remote(), repo)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('would add nothing')
    expect(res.stderr).toContain('already on main as')
    expect(tickets()).toHaveLength(0)
  })

  it('ALLOWS genuinely new work, and takes a ticket', () => {
    const res = check(brandNew, remote(), repo)
    expect(res.status).toBe(0)
    expect(res.stderr).not.toContain('would add nothing')
    expect(tickets()).toHaveLength(1)
  })

  it('ALLOWS a tip whose TOP commit is a duplicate but which carries new work below it', () => {
    // 🛑 The stranding case. `strandingTip`'s own patch-id IS already upstream,
    // so a tip-only test refuses this and loses the commit underneath.
    expect(patchId(strandingTip, repo)).toBe(patchId(main, repo))

    const res = check(strandingTip, remote(), repo)
    expect(res.status).toBe(0)
    expect(res.stderr).not.toContain('would add nothing')
    expect(tickets()).toHaveLength(1)
  })

  it('fails OPEN when the remote is unreadable — it can never block on a doubt', () => {
    const res = check(dupOfLanded, { AF_PUSH_QUEUE_NO_REMOTE: '1' }, repo)
    expect(res.status).toBe(0)
    expect(res.stderr).not.toContain('would add nothing')
  })

  it('fails OPEN when the range is larger than the scan cap', () => {
    // ⚠ The cap is parsed with Number.parseInt, NOT `Number(x) || 200` — 0 is
    // falsy, so the `||` form swallowed an explicit 0 and this control passed
    // against the default while appearing to test the cap.
    const res = check(dupOfLanded, remote({ AF_PUSH_QUEUE_UPSTREAM_CAP: '0' }), repo)
    expect(res.status).toBe(0)
    expect(res.stderr).not.toContain('would add nothing')
  })

  it('honours the deliberate re-land escape hatch', () => {
    const res = check(dupOfLanded, remote({ AF_PUSH_QUEUE_ALLOW_DUPLICATE: '1' }), repo)
    expect(res.status).toBe(0)
    expect(tickets()).toHaveLength(1)
  })
})

describe('push-queue — main that refuses DIRECT pushes sends you to a PR, not round a rebuild loop', () => {
  /**
   * 🛑 THE WHOLE QUEUE ASSUMES A DIRECT PUSH TO refs/heads/main. When branch protection starts
   * enforcing required checks on everyone, that assumption is false — and the queue does not
   * merely stop helping, it actively misleads: a session waits its full turn, pays the ~25s
   * secret scan and the typecheck smoke, reaches the head of the line, and is refused by GitHub
   * having read nothing but advice about stale bases. "Rebuild and re-run" is a loop that cannot
   * terminate.
   *
   * These push to a REAL local bare remote whose `pre-receive` hook rejects the way GitHub does,
   * so the capture → classify → record → refuse-next-ticket path is exercised end to end rather
   * than by feeding a string to a matcher.
   */
  let remote: string
  let work: string
  let sha: string

  const g = (args: string[], cwd: string) =>
    execFileSync(
      'git',
      ['-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { encoding: 'utf8', cwd },
    ).trim()

  /** A bare remote whose pre-receive hook refuses, printing `text` on stderr. */
  const makeRemote = (text: string | null) => {
    const bare = mkdtempSync(join(tmpdir(), 'af-pq-remote-'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
    if (text !== null) {
      const hook = join(bare, 'hooks', 'pre-receive')
      writeFileSync(hook, `#!/bin/sh\necho "${text}" >&2\nexit 1\n`)
      try {
        execFileSync('chmod', ['+x', hook])
      } catch {
        /* windows: git for windows runs the hook via sh regardless of the mode bit */
      }
    }
    return bare
  }

  const pushOnce = (env: Record<string, string> = {}) =>
    run(['push', '--', 'origin', `${sha}:refs/heads/main`], '', env, work)

  const markerPath = () => join(queueDir, 'direct-push-blocked.json')

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'af-pq-work-'))
    g(['init', '-q', '-b', 'main'], work)
    writeFileSync(join(work, 'a.txt'), 'a\n')
    g(['add', 'a.txt'], work)
    g(['commit', '-q', '-m', 'c0'], work)
    sha = g(['rev-parse', 'HEAD'], work)
  })

  afterEach(() => {
    rmSync(work, { recursive: true, force: true })
    if (remote) rmSync(remote, { recursive: true, force: true })
    rmSync(markerPath(), { force: true })
  })

  it('records a marker when the remote rejects with a branch-protection message', () => {
    remote = makeRemote('GH006: Protected branch update failed for refs/heads/main.')
    g(['remote', 'add', 'origin', remote], work)

    const res = pushOnce()

    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('REFUSES direct pushes')
    expect(existsSync(markerPath())).toBe(true)
  })

  it('the NEXT ticket is then refused up front, before any wait — and takes no ticket', () => {
    // The saving is the whole point: refusing at the head of the line is a correct answer
    // delivered after the cost has already been paid.
    writeFileSync(markerPath(), JSON.stringify({ observedAt: Date.now(), evidence: 'GH006' }))

    const res = check(SHA_B)

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('needs a pull request')
    expect(res.stderr).toContain('gh pr create')
    expect(tickets()).toHaveLength(0)
  })

  it('🛑 does NOT classify an ordinary non-fast-forward as protection — the negative control', () => {
    // A false positive here is worse than no feature: it would tell a session to open a PR when
    // the real problem was a stale base, and record that for everyone else too.
    remote = makeRemote('! [rejected] main -> main (non-fast-forward)')
    g(['remote', 'add', 'origin', remote], work)

    const res = pushOnce()

    expect(res.status).not.toBe(0)
    expect(res.stderr).not.toContain('REFUSES direct pushes')
    expect(existsSync(markerPath())).toBe(false)
  })

  it('an EXPIRED marker is ignored, so a one-off rejection cannot wedge the queue forever', () => {
    writeFileSync(
      markerPath(),
      JSON.stringify({ observedAt: Date.now() - 60_000, evidence: 'GH006' }),
    )
    const res = check(SHA_B, { AF_PUSH_QUEUE_PROTECTION_TTL_MS: '1000' })

    expect(res.status).toBe(0)
    expect(res.stderr).not.toContain('needs a pull request')
  })

  it('AF_PUSH_QUEUE_IGNORE_PROTECTION=1 bypasses a live marker', () => {
    writeFileSync(markerPath(), JSON.stringify({ observedAt: Date.now(), evidence: 'GH006' }))
    const res = check(SHA_B, { AF_PUSH_QUEUE_IGNORE_PROTECTION: '1' })

    expect(res.status).toBe(0)
    expect(res.stderr).not.toContain('needs a pull request')
  })

  it('a corrupt marker is ignored rather than blocking every push', () => {
    writeFileSync(markerPath(), 'not json at all')
    const res = check(SHA_B)

    expect(res.status).toBe(0)
    expect(res.stderr).not.toContain('needs a pull request')
  })
})

describe('push-queue — a protection marker must not deadlock the room', () => {
  /**
   * 🛑 THE FIRST VERSION OF THIS FEATURE DEADLOCKED, AND IT HAPPENED FOR REAL. The marker was
   * cleared only by a SUCCESSFUL direct push — but the marker is what prevents the push. When
   * protection was reverted ~25 min after being enabled, every session in the room was refused
   * for a false reason until the file was deleted by hand. "Clears on success" is not
   * self-healing when the block is what stops success.
   *
   * So a marker older than the re-probe interval lets ONE push through to re-test. These assert
   * both halves: it still refuses inside the interval, and it stops refusing after it.
   */
  const markerPath = () => join(queueDir, 'direct-push-blocked.json')
  afterEach(() => rmSync(markerPath(), { force: true }))

  it('still refuses INSIDE the re-probe interval — the saving is not given away', () => {
    writeFileSync(markerPath(), JSON.stringify({ observedAt: Date.now(), evidence: 'GH006' }))
    const res = check(SHA_B, { AF_PUSH_QUEUE_PROTECTION_REPROBE_MS: '600000' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('needs a pull request')
  })

  it('lets ONE push through once the interval has passed, and says it is re-testing', () => {
    writeFileSync(markerPath(), JSON.stringify({ observedAt: Date.now() - 60_000, evidence: 'GH006' }))
    const res = check(SHA_B, { AF_PUSH_QUEUE_PROTECTION_REPROBE_MS: '1000' })
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('re-testing with this push')
  })

  it('stamps lastProbeAt so nine concurrent sessions do not all probe at once', () => {
    writeFileSync(markerPath(), JSON.stringify({ observedAt: Date.now() - 60_000, evidence: 'GH006' }))
    check(SHA_B, { AF_PUSH_QUEUE_PROTECTION_REPROBE_MS: '1000' })
    const after = JSON.parse(readFileSync(markerPath(), 'utf8'))
    expect(Number(after.lastProbeAt)).toBeGreaterThan(0)

    // The SECOND session in the same interval is refused again rather than probing too.
    const second = check(SHA_C, { AF_PUSH_QUEUE_PROTECTION_REPROBE_MS: '600000' })
    expect(second.status).toBe(1)
    expect(second.stderr).toContain('needs a pull request')
  })
})

describe('push-queue — going to the back of the line is never silent', () => {
  /**
   * 🛑 MEASURED LOSS, 2026-09-12: a 3-commit tip rebuilt as a 4-commit tip in a DIFFERENT
   * worktree matched neither inheritance rule — the tip's patch-id changed, and the worktree gate
   * blocked the ancestry path — so a fresh ticket was created at the back and 84 minutes of queue
   * position went without a word. The position was recoverable by `rebind` the whole time; the
   * author had no reason to run it because nothing said so.
   *
   * ⚠ The same signal has a SECOND meaning and that is why it warns even for someone else's
   * ticket: an unlanded queued commit sitting inside your tip means you may be about to push a
   * peer's unattested work. Both readings are worth interrupting for.
   *
   * ⚠ AND IT MUST NOT FIRE ON LANDED WORK, which is the common case: everyone's tip descends
   * from main, so every ticket already on main is an ancestor of everyone's tip. Without that
   * exclusion this would warn on essentially every push and be ignored within a day.
   */
  let repo: string
  let worktree: string
  let base: string
  let mid: string
  let tip: string

  const g = (args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { encoding: 'utf8', cwd: repo }).trim()

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'af-pq-back-'))
    g(['init', '-q', '-b', 'main'])
    g(['commit', '-q', '--allow-empty', '-m', 'c0']); base = g(['rev-parse', 'HEAD'])
    g(['commit', '-q', '--allow-empty', '-m', 'c1']); mid = g(['rev-parse', 'HEAD'])
    g(['commit', '-q', '--allow-empty', '-m', 'c2']); tip = g(['rev-parse', 'HEAD'])
    /*
     * ⚠ SEED THE WORKTREE THE WAY THE TOOL DERIVES IT, not the mkdtemp path. `ctx.worktree` is
     * `git rev-parse --show-toplevel`, which on Windows returns FORWARD slashes while mkdtempSync
     * returns backslashes — so `t.worktree === ctx.worktree` compared unequal and a same-worktree
     * case presented as a cross-worktree one. Two wrong diagnoses were made from that before the
     * warning's own message named the mismatched path and gave it away.
     */
    worktree = g(['rev-parse', '--show-toplevel'])
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('a SAME-worktree descendant still inherits — no warning is needed because nothing is lost', () => {
    // 🛑 This assertion was originally written the other way round, expecting the warning, and the
    // test corrected the author's model of his own bug: same-worktree + descendant is exactly what
    // the ancestry rule inherits, so no ticket is created and there is nothing to report. The loss
    // being guarded against was CROSS-worktree specifically. Pinned so nobody "fixes" the warning
    // to fire here and makes it noise on the working path.
    seed(1, mid, { worktree })
    const res = check(tip, { AF_PUSH_QUEUE_NO_REMOTE: '0', AF_PUSH_QUEUE_REMOTE_SHA: base }, repo)

    expect(res.stderr).not.toContain('UNLANDED commit inside the tip')
    const t = tickets().find((x) => x.seq === 1)
    expect(t?.sha).toBe(tip) // the SAME ticket now covers the new tip
    expect(tickets()).toHaveLength(1) // and no second ticket was taken
  })

  it('names the OTHER-worktree case differently — you may be carrying a peer\'s commit', () => {
    seed(1, mid, { worktree: '/some/other/session/wt-peer' })
    const res = check(tip, { AF_PUSH_QUEUE_NO_REMOTE: '0', AF_PUSH_QUEUE_REMOTE_SHA: base }, repo)

    expect(res.stderr).toContain('ANOTHER worktree')
    expect(res.stderr).toContain("peer's unattested commit")
    expect(res.stderr).not.toContain('push:rebind')
  })

  it('🛑 does NOT warn when that ticket is already on main — the common case, or it warns always', () => {
    // Same shape, except main is at `mid`, so the ticket's commit has landed.
    seed(1, mid, { worktree })
    const res = check(tip, { AF_PUSH_QUEUE_NO_REMOTE: '0', AF_PUSH_QUEUE_REMOTE_SHA: mid }, repo)

    expect(res.stderr).not.toContain('UNLANDED commit inside the tip')
  })

  it('does not warn when no live ticket is an ancestor at all', () => {
    seed(1, SHA_A, { worktree })
    const res = check(tip, { AF_PUSH_QUEUE_NO_REMOTE: '0', AF_PUSH_QUEUE_REMOTE_SHA: base }, repo)

    expect(res.stderr).not.toContain('UNLANDED commit inside the tip')
  })
})
