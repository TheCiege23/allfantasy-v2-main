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
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
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
  const parent = execFileSync('git', ['rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim()
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

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
