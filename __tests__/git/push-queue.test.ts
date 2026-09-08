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
function run(args: string[], payload: string, env: Record<string, string> = {}): RunResult {
  const res = spawnSync('node', [SCRIPT, ...args], {
    input: payload,
    encoding: 'utf8',
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

const check = (sha: string, env?: Record<string, string>) => run(['check'], mainPayload(sha), env)

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
  const rev = (ref: string) => execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim()

  /**
   * `allowedAt` is NOW, so the grace cannot be what releases this — only the
   * landed check can. Dating it in the past would conflate the two and this test
   * would go green for the other one's reason.
   */
  it('releases a pushing ticket whose commit is an ancestor of the tip, not the tip itself', () => {
    const tip = rev('origin/main')
    const mine = rev('origin/main~3')
    expect(mine).not.toBe(tip) // the whole point: mine is ON main but is not the tip

    seed(1, mine, { state: 'pushing', allowedAt: Date.now() })

    const res = check(SHA_B, { AF_PUSH_QUEUE_NO_REMOTE: '0', AF_PUSH_QUEUE_REMOTE_SHA: tip })

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
    const tip = rev('origin/main')

    seed(1, SHA_A, { state: 'pushing', allowedAt: Date.now() })

    const res = check(SHA_B, { AF_PUSH_QUEUE_NO_REMOTE: '0', AF_PUSH_QUEUE_REMOTE_SHA: tip })

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
