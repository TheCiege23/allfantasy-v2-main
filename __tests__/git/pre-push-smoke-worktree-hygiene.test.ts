/**
 * The shared smoke worktree must present the COMMIT being pushed, and nothing else.
 *
 * WHAT HAPPENED (measured 2026-09-11)
 * `.git/af-smoke-worktree` is reused by every push from every session, and `pre-push-smoke.mjs`
 * prepares it with `git checkout --detach --force <sha>`. A crashed run left a zero-byte
 * `index.lock` behind; with the index frozen the checkout could not advance, the worktree stayed
 * pinned at an old sha, and 47 paths that had landed on `main` since read as UNTRACKED. The
 * ratchet compiles what is on disk, so those files were typechecked, their errors were absent
 * from the pushed commit's baseline, and the guard reported the one thing it reports for a real
 * regression: a new file with errors. Two pushes were blocked over code their author never wrote.
 *
 * 🛑 AND THE OBVIOUS REPAIR IS THE DANGEROUS ONE. `git clean -fd` on that worktree the same day
 * would have destroyed three files of a peer's work whose content existed on NO REF in the
 * repository — no conflict, no failing test, nothing to recover from. So the fix MOVES strays and
 * never deletes them, and the test that matters most here is the one asserting the content
 * survives the move.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  STALE_LOCK_MS,
  clearStaleIndexLock,
  listUntracked,
  quarantineUntracked,
  // @ts-expect-error -- plain .mjs helper, no type declarations by design
} from '../../scripts/smoke-worktree-hygiene.mjs'

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

const g = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()

/** A throwaway repo with one commit, standing in for the smoke worktree. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'af-smoke-hygiene-'))
  made.push(root)
  g(['init', '--quiet'], root)
  g(['config', 'user.email', 'test@example.com'], root)
  g(['config', 'user.name', 'test'], root)
  writeFileSync(join(root, 'tracked.ts'), 'export const a = 1\n')
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n')
  g(['add', '--', 'tracked.ts', '.gitignore'], root)
  g(['commit', '--quiet', '-m', 'base'], root)
  return root
}

describe('the git behaviour the fix rests on', () => {
  /*
   * 🛑 A POSITIVE CONTROL FOR THE PREMISE, NOT FOR THE FIX. If `checkout --force` ever started
   * removing untracked files, the quarantine below would be guarding a state that cannot occur —
   * and this is what would say so, rather than the fix quietly becoming dead code.
   */
  it('`checkout --detach --force` leaves an untracked file exactly where it was', () => {
    const root = makeRepo()
    const head = g(['rev-parse', 'HEAD'], root)

    writeFileSync(join(root, 'stray.ts'), 'export const broken: number = "no"\n')
    g(['checkout', '--detach', '--force', head], root)

    expect(existsSync(join(root, 'stray.ts'))).toBe(true)
    expect(listUntracked(root)).toContain('stray.ts')
  })
})

describe('quarantineUntracked', () => {
  it('moves strays out of the worktree and PRESERVES their content', () => {
    const root = makeRepo()
    const qRoot = mkdtempSync(join(tmpdir(), 'af-smoke-q-'))
    made.push(qRoot)

    const body = 'export const onlyCopy = "not on any ref"\n'
    writeFileSync(join(root, 'stray.ts'), body)
    mkdirSync(join(root, 'nested', 'deep'), { recursive: true })
    writeFileSync(join(root, 'nested', 'deep', 'other.ts'), body)

    const res = quarantineUntracked(root, qRoot)

    expect(res.moved.sort()).toEqual(['nested/deep/other.ts', 'stray.ts'])
    expect(res.failed).toEqual([])

    // Gone from the compile set...
    expect(existsSync(join(root, 'stray.ts'))).toBe(false)
    expect(listUntracked(root)).toEqual([])

    // ...and recoverable, byte for byte, at a path that mirrors where it was.
    expect(readFileSync(join(res.dir, 'stray.ts'), 'utf8')).toBe(body)
    expect(readFileSync(join(res.dir, 'nested', 'deep', 'other.ts'), 'utf8')).toBe(body)
  })

  /*
   * ⚠ THE ONE THAT WOULD HURT EVERY SESSION ON THE BOX. In the real worktree `node_modules` is a
   * junction to the primary checkout's real one. It is gitignored, and this asks for untracked
   * files WITHOUT `--ignored` precisely so it can never be enumerated — CLAUDE.md records a
   * worktree cleanup that followed that junction and deleted the primary's copy.
   */
  it('does not touch gitignored paths', () => {
    const root = makeRepo()
    const qRoot = mkdtempSync(join(tmpdir(), 'af-smoke-q-'))
    made.push(qRoot)

    mkdirSync(join(root, 'node_modules', 'left-pad'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')

    const res = quarantineUntracked(root, qRoot)

    expect(res.moved).toEqual([])
    expect(existsSync(join(root, 'node_modules', 'left-pad', 'index.js'))).toBe(true)
  })

  it('is a no-op on a clean worktree, and writes no quarantine directory', () => {
    const root = makeRepo()
    const qRoot = join(mkdtempSync(join(tmpdir(), 'af-smoke-q-')), 'never')
    made.push(qRoot)

    const res = quarantineUntracked(root, qRoot)

    expect(res.moved).toEqual([])
    expect(res.dir).toBeNull()
    expect(existsSync(qRoot)).toBe(false)
  })
})

describe('clearStaleIndexLock', () => {
  const lockPath = (root: string) => join(root, '.git', 'index.lock')

  it('removes a lock old enough that no live git could hold it', () => {
    const root = makeRepo()
    writeFileSync(lockPath(root), '')
    const old = new Date(Date.now() - 6 * 60 * 60_000)
    utimesSync(lockPath(root), old, old)

    const res = clearStaleIndexLock(root)

    expect(res.cleared).toBe(true)
    expect(existsSync(lockPath(root))).toBe(false)
  })

  /*
   * 🛑 THE SAFETY PROPERTY, AND THE REASON THIS IS AGE-BASED RATHER THAN UNCONDITIONAL. Two
   * sessions can push at once. Deleting a lock a live git is holding corrupts the index it is
   * mid-write on, which is a strictly worse failure than the stuck worktree being repaired.
   */
  it('REFUSES a fresh lock, because a live git may be holding it', () => {
    const root = makeRepo()
    writeFileSync(lockPath(root), '')

    const res = clearStaleIndexLock(root)

    expect(res.cleared).toBe(false)
    expect(res.reason).toMatch(/live git may hold it/)
    expect(existsSync(lockPath(root))).toBe(true)
  })

  it('reports "no lock" rather than failing when there is nothing to clear', () => {
    const res = clearStaleIndexLock(makeRepo())
    expect(res.cleared).toBe(false)
    expect(res.reason).toBe('no lock')
  })

  it('holds the threshold at ten minutes', () => {
    // Pinned because the prose in both files quotes it; a drift here makes the message a lie.
    expect(STALE_LOCK_MS).toBe(10 * 60_000)
  })
})
