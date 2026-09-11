/**
 * Keeping the SHARED smoke worktree honest between runs.
 *
 * `pre-push-smoke.mjs` reuses one worktree — `.git/af-smoke-worktree` — across every push from
 * every session, and prepares it with `git checkout --detach --force <sha>`. That command
 * overwrites TRACKED files and says nothing about untracked ones, so anything that lands in that
 * directory by another route stays there forever and is compiled by every later run.
 *
 * 🛑 WHAT THAT COSTS, MEASURED 2026-09-11. A crashed run left a zero-byte `index.lock` (5.3h old)
 * in `.git/worktrees/af-smoke-worktree`. With the index frozen the checkout could not advance, the
 * worktree stuck at an old sha, and files added to `main` afterwards read as UNTRACKED — 47 of
 * them at the time this was written. The ratchet compiles whatever is on disk, sees files carrying
 * errors that its baseline has never heard of, and reports exactly what a real regression reports:
 *
 *     a new file appearing with errors, relative to that SHA's own baseline  ->  push BLOCKED
 *
 * The blocked session did not write those files and cannot find them in its own commit. Two of my
 * own pushes died that way before the worktree was the suspect rather than the code.
 *
 * ⚠ SO THE OBVIOUS REPAIR IS THE DANGEROUS ONE, AND THAT IS WHY THIS MOVES RATHER THAN DELETES.
 * `git clean -fd` is what you reach for, and running it on that worktree the same day would have
 * destroyed three files of a peer's work that existed on NO REF anywhere in the repository —
 * checked against all 862 at the time. They reached that directory by some route nobody has
 * reconstructed, and a delete would have left no conflict, no failing test, and nothing to
 * recover from: the author would simply have found their files gone.
 *
 * A per-push hook cannot afford the reachability scan that settles whether a stray is somebody's
 * only copy — it is ~40,000 `git ls-tree` calls and takes minutes. **So it must never be in a
 * position to need it.** Quarantine costs a rename and is wrong in no case; deletion is fast,
 * correct almost always, and unrecoverable the one time it is not.
 *
 * ⚠ `git cat-file -e` DOES NOT ANSWER THIS, though it looks like it does. A checkout writes blobs
 * into the object store whether or not anything ever commits them, so the blob for an unbacked
 * file is present and the test passes. "The object is in the store" and "someone can get this
 * back" are different claims, and only reachability from a ref settles the second.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/**
 * How old a lock must be before this treats it as abandoned.
 *
 * ⚠ AGE IS THE WHOLE SAFETY ARGUMENT, so it is not a formality. A legitimate `index.lock` is held
 * for the duration of one index write — well under a second even on this box. Two sessions CAN
 * push concurrently, so a lock that might belong to a live git must be left alone; ten minutes is
 * far outside any honest hold and far inside the 5.3 hours actually observed.
 */
export const STALE_LOCK_MS = 10 * 60_000

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15_000, windowsHide: true }).trim()
  } catch {
    return null
  }
}

/**
 * Remove an abandoned `index.lock` from the worktree's git dir.
 *
 * Returns `{ cleared, reason, path, ageMs }`. `cleared: false` is the common and correct outcome —
 * the caller reports rather than retries, because every non-cleared reason here is either "nothing
 * to do" or "something else may be using it".
 */
export function clearStaleIndexLock(worktreeDir, { maxAgeMs = STALE_LOCK_MS, now = Date.now() } = {}) {
  const lockPath = git(['-C', worktreeDir, 'rev-parse', '--path-format=absolute', '--git-path', 'index.lock'], worktreeDir)
  if (!lockPath) return { cleared: false, reason: 'could not resolve the worktree git dir', path: null, ageMs: null }
  if (!existsSync(lockPath)) return { cleared: false, reason: 'no lock', path: lockPath, ageMs: null }

  let ageMs = null
  try {
    ageMs = now - statSync(lockPath).mtimeMs
  } catch (err) {
    return { cleared: false, reason: `could not stat the lock: ${err.message}`, path: lockPath, ageMs: null }
  }

  if (ageMs < maxAgeMs) {
    return {
      cleared: false,
      reason: `lock is ${Math.round(ageMs / 1000)}s old (under ${Math.round(maxAgeMs / 60_000)}min) — a live git may hold it`,
      path: lockPath,
      ageMs,
    }
  }

  try {
    unlinkSync(lockPath)
  } catch (err) {
    return { cleared: false, reason: `stale lock could not be removed: ${err.message}`, path: lockPath, ageMs }
  }
  return { cleared: true, reason: `removed a lock ${Math.round(ageMs / 60_000)}min old`, path: lockPath, ageMs }
}

/**
 * Every untracked path in the worktree, one file per entry.
 *
 * ⚠ `-uall` EXPANDS DIRECTORIES, and that matters for more than tidiness: the default
 * `--untracked-files=normal` collapses a whole untracked tree to `lib/decision-os/envelope/`, and
 * moving a path you have not enumerated is how a quarantine takes more than it reported.
 *
 * ⚠ NO `--ignored`, DELIBERATELY. `node_modules` is gitignored, and in this worktree it is a
 * JUNCTION to the primary checkout's real one. Quarantining it would move — or on a bad day
 * recurse into and destroy — the node_modules every session on this box shares. This repo's own
 * history records a worktree cleanup that followed that junction. Ignored means ignored.
 */
export function listUntracked(worktreeDir) {
  const out = git(['-C', worktreeDir, 'status', '--porcelain', '-uall'], worktreeDir)
  if (out === null) return null
  return out
    .split('\n')
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(3).trim())
    .map((p) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p))
    .filter(Boolean)
}

/**
 * Move every untracked file out of the worktree and into `quarantineRoot/<stamp>/`, preserving
 * relative paths. Returns `{ stamp, dir, moved, failed, skipped }`.
 *
 * 🛑 CALL THIS AFTER THE CHECKOUT, NEVER BEFORE. Ordering is not cosmetic here. A worktree stuck
 * at an old sha reports every file added to `main` since as untracked — 47 of them in the incident
 * above, of which all but a handful were ordinary landed code. Checking out the pushed sha first
 * re-tracks those, so what remains is the genuine stray set. Quarantining first would shovel
 * dozens of perfectly safe files into a quarantine directory on the first run and tell the pusher
 * nothing true.
 *
 * ⚠ The quarantine root MUST be outside the worktree, or the next run quarantines the quarantine.
 */
export function quarantineUntracked(worktreeDir, quarantineRoot, { now = new Date() } = {}) {
  const untracked = listUntracked(worktreeDir)
  if (untracked === null) return { stamp: null, dir: null, moved: [], failed: [], skipped: [], error: 'git status failed' }
  if (untracked.length === 0) return { stamp: null, dir: null, moved: [], failed: [], skipped: [] }

  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const dir = join(quarantineRoot, stamp)
  const wtRoot = resolve(worktreeDir)

  const moved = []
  const failed = []
  const skipped = []

  for (const rel of untracked) {
    /*
     * A path git reports is a path git controls, so this cannot normally escape. It is checked
     * anyway because the consequence is a move OUTSIDE the worktree — the one error in this file
     * that would touch something nobody asked us to touch.
     */
    const from = resolve(wtRoot, rel)
    const inside = !isAbsolute(rel) && !relative(wtRoot, from).startsWith('..')
    if (!inside) {
      skipped.push({ rel, why: 'path resolves outside the worktree' })
      continue
    }

    const to = join(dir, rel)
    try {
      mkdirSync(dirname(to), { recursive: true })
      try {
        renameSync(from, to)
      } catch (err) {
        // Quarantine can land on a different volume from the worktree (the worktree falls back to
        // the system temp dir when the git common dir cannot host it). rename() refuses across
        // devices; copy-then-unlink is the same outcome, one syscall later.
        if (err.code !== 'EXDEV') throw err
        copyFileSync(from, to)
        rmSync(from, { force: true })
      }
      moved.push(rel)
    } catch (err) {
      // A stray that could not be moved stays where it is. It will be reported, and it will be
      // compiled — which is the pre-existing behaviour, not a new failure.
      failed.push({ rel, why: err.message })
    }
  }

  return { stamp, dir, moved, failed, skipped }
}
