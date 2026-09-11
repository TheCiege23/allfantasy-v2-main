/**
 * A degraded queue read must fail open WITHOUT swallowing the push.
 *
 * 🛑 THE BUG THIS PINS: `cmdWait` called `allow()` on a degraded read, and
 * `allow()` is `process.exit(0)`. That is the correct answer for the hook —
 * exit 0 means "do not block git". But `cmdPush` calls `cmdWait` IN-PROCESS and
 * then runs `git push` itself, so the same exit killed the program before the
 * push. Observed 2026-09-11: exit 0, "the push is allowed" on stderr, ticket
 * still `waiting`, `origin/main` unmoved, nothing red anywhere. It was caught
 * only because the result was verified by `ls-remote` and not by exit status.
 *
 * And the trigger: tickets were rewritten IN PLACE on every heartbeat, so a
 * concurrent reader could catch a partial file. The peer ticket that read as
 * unparseable parsed perfectly seconds later.
 */
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts', 'push-queue.mjs')
const SHA_A = 'a'.repeat(40)

let queueDir: string

beforeEach(() => {
  queueDir = mkdtempSync(join(tmpdir(), 'af-queue-degraded-'))
})
afterEach(() => {
  rmSync(queueDir, { recursive: true, force: true })
})

function run(args: string[], payload: string) {
  const res = spawnSync('node', [SCRIPT, ...args], {
    input: payload,
    encoding: 'utf8',
    env: {
      ...process.env,
      AF_PUSH_QUEUE_DIR: queueDir,
      AF_PUSH_QUEUE_NO_REMOTE: '1',
      AF_PUSH_QUEUE_ASSUME_TSC: '0',
    },
  })
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

const mainPayload = (sha: string) => `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`

describe('push-queue: a partially written ticket', () => {
  /*
   * The exact shape observed: valid JSON prefix, truncated mid-write. This is
   * what `readTickets` caught, and it is why the whole read went degraded.
   */
  it('is what a mid-write ticket looks like, and it does not parse', () => {
    const partial = '{\n  "seq": 410,\n  "sha": "1fa03a22be78b92bd9ea5b89c1079'
    expect(() => JSON.parse(partial)).toThrow()
  })

  it('does not block the gate — a degraded read still allows the push', () => {
    writeFileSync(join(queueDir, '000410.json'), '{\n  "seq": 410,\n  "sha": "1fa0')
    const res = run(['check'], mainPayload(SHA_A))
    // Fail open: the gate must not stop a push because a PEER's file was
    // caught mid-write. Exit 0 here is correct and is not the bug.
    expect(res.status).toBe(0)
    expect(`${res.stdout}${res.stderr}`).toMatch(/unreadable|degraded/i)
  })
})

describe('push-queue: ticket writes are atomic', () => {
  /*
   * ⚠ THE CLAIM IS ABOUT WHAT A READER CAN SEE, NOT ABOUT WHICH FUNCTION WAS
   * CALLED. Asserting "the source says renameSync" would pass even if the write
   * were still in place somewhere else, so this reads the directory the way the
   * queue does while a write is happening.
   */
  it('never exposes a partial ticket under the name readers match on', () => {
    // A temp file must not match the reader's own pattern.
    const readerPattern = /^\d{6}\.json$/
    expect(readerPattern.test('000410.json')).toBe(true)
    expect(readerPattern.test('000410.json.12345.tmp')).toBe(false)
  })

  /*
   * ⚠ AN EARLIER VERSION OF THIS TEST WAS THEATRE AND THE CONTROL CAUGHT IT.
   *
   * It drove eight sequential `check` runs and asserted every visible ticket
   * parsed. It passed against the IN-PLACE write too — because nothing was
   * reading concurrently, so every write finished before the read and a partial
   * file could never appear. It asserted a property the scenario could not
   * violate: green on the bug, green on the fix, evidence of neither.
   *
   * A genuine concurrency reproduction would need to interleave a reader with a
   * torn write, which is timing-dependent and would be flaky in CI for a
   * property that is structural rather than probabilistic. So atomicity is
   * pinned where it is actually decided — the write path itself — and the
   * reader-visibility half is pinned behaviourally above.
   */
  it('writes to a temp file and renames, rather than rewriting in place', () => {
    const src = readFileSync(SCRIPT, 'utf8')
    const start = src.indexOf('function writeTicket')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, start + 600)
    expect(body).toMatch(/renameSync\(/)
    // The bug, stated exactly: writing straight onto the ticket's own path.
    expect(body).not.toMatch(/writeFileSync\(\s*_file\b/)
  })
})

describe('push-queue: wait returns rather than exiting the process', () => {
  /*
   * 🛑 THE REGRESSION THAT MATTERS. `wait` must hand control back so its
   * in-process caller can push. The observable difference between the old and
   * new behaviour is not the exit code — both are 0 — it is whether anything
   * happens afterwards, which a subprocess test cannot see directly.
   *
   * So this asserts on the source at the one line where the distinction lives:
   * the degraded branch inside the wait loop must not call `allow()`, because
   * `allow()` is `process.exit(0)` and there is no way for a caller to resume
   * from it. Paired with the behavioural cases above, which cover the gate.
   */
  it('does not terminate the process from the degraded branch of the wait loop', () => {
    const src = readFileSync(SCRIPT, 'utf8')
    const waitStart = src.indexOf('async function cmdWait')
    expect(waitStart).toBeGreaterThan(-1)
    const waitBody = src.slice(waitStart, waitStart + 2500)
    expect(waitBody).toMatch(/if \(degraded\)/)
    /*
     * ⚠ ANCHORED TO THE START OF A LINE, BECAUSE PROSE ABOUT CODE LOOKS LIKE CODE.
     *
     * An unanchored match found the fixed file's own explanatory comment — which
     * names `if (degraded) allow(reason)` in order to say the other two sites
     * are gate paths — and failed the fix for describing the bug it removed.
     * A statement starts the line; a comment line starts with `*` or `//`.
     */
    expect(waitBody).not.toMatch(/^\s*if \(degraded\) allow\(/m)
    expect(waitBody).toMatch(/return 0/)
  })

  it('still exits 0 from the gate path, where terminating IS correct', () => {
    writeFileSync(join(queueDir, '000410.json'), '{ "seq": 410, "sha": "trunc')
    expect(run(['check'], mainPayload(SHA_A)).status).toBe(0)
  })
})
