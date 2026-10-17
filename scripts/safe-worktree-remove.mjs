/**
 * Remove a git worktree WITHOUT being able to delete through its node_modules junction.
 *
 *   node scripts/safe-worktree-remove.mjs <worktree-path> [--force]
 *   npm run wt:remove -- <worktree-path> [--force]
 *
 * 🛑 WHY THIS EXISTS. Every worktree here junctions node_modules to the primary checkout's, and
 * `git worktree remove` (like `Remove-Item -Recurse`) deletes THROUGH a junction it finds — emptying
 * the shared folder every session depends on. On 2026-10-01 that happened TWICE in one afternoon
 * (~15:44 and ~16:45 UTC), both times after a careful session ran a "is it a junction?" check first:
 * one compared PowerShell output that ended in `\r`, the other got a plain false "no junction". The
 * rule ("`cmd /c rmdir` the junction first") was already in CLAUDE.md; a rule that depends on a
 * detection step being right is what failed.
 *
 * So this script NEVER decides whether to unlink based on detecting a link. It unlinks BY EFFECT:
 * a non-recursive `rmdir` removes a junction (or an empty folder) and REFUSES a real non-empty
 * folder; a symlink on POSIX gets `unlink`. Either way the entry must be gone afterwards, and the
 * shared node_modules must have exactly as many entries after as before — counted BEFORE the git
 * call, so a shrink aborts the removal instead of being reported after the damage.
 *
 * Uses only Node built-ins on purpose: it must work when the shared node_modules is the thing that
 * is empty.
 *
 * Exit codes: 0 removed · 1 git failed · 2 refused (nothing deleted) · 3 shared node_modules shrank.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function norm(p) {
  return path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function lexists(p) {
  try {
    fs.lstatSync(p)
    return true
  } catch (e) {
    if (e && e.code === 'ENOENT') return false
    throw e
  }
}

/** Entries in a directory, or null when it cannot be read (absent counts as null, not 0). */
export function countEntries(dir) {
  try {
    return fs.readdirSync(dir).length
  } catch {
    return null
  }
}

/**
 * Remove `p` if it is a link (junction or symlink), WITHOUT ever recursing into it.
 * Never asks "is this a link?" — it tries the operations that can only ever remove a link or an empty
 * directory, and refuses anything else.
 * @returns {{ status: 'absent' | 'unlinked' | 'refused', detail: string }}
 */
export function unlinkByEffect(p) {
  if (!lexists(p)) return { status: 'absent', detail: `${p} does not exist` }
  try {
    // Non-recursive: removes a Windows junction or an EMPTY directory; throws on a non-empty real dir.
    fs.rmdirSync(p)
  } catch (e) {
    const code = e && e.code
    if (code === 'ENOTDIR') {
      // POSIX symlink (or a file): unlink removes the link itself, never its target.
      fs.unlinkSync(p)
    } else if (code === 'ENOTEMPTY' || code === 'EEXIST') {
      return {
        status: 'refused',
        detail: `${p} is a real, non-empty directory — not a link. Refusing to touch it; inspect it by hand.`,
      }
    } else {
      return { status: 'refused', detail: `could not unlink ${p}: ${code ?? e}` }
    }
  }
  if (lexists(p)) return { status: 'refused', detail: `${p} still exists after unlinking` }
  return { status: 'unlinked', detail: `unlinked ${p}` }
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** The primary checkout's root (the parent of the shared git dir), from any checkout of the repo. */
export function resolvePrimaryRoot(cwd) {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim()
  return path.dirname(common)
}

export function listWorktrees(cwd) {
  return git(['worktree', 'list', '--porcelain'], cwd)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
}

/**
 * @param {{ worktree: string, force?: boolean, cwd?: string,
 *           count?: (dir: string) => number | null,
 *           removeWorktree?: (wt: string, force: boolean, cwd: string) => void }} opts
 * `count` and `removeWorktree` are injectable for tests; defaults are the real filesystem and git.
 */
export function safeWorktreeRemove(opts) {
  const cwd = opts.cwd ?? process.cwd()
  const count = opts.count ?? countEntries
  const removeWorktree =
    opts.removeWorktree ??
    ((wt, force, dir) => git(['worktree', 'remove', ...(force ? ['--force'] : []), wt], dir))
  const wt = path.resolve(opts.worktree)

  const primaryRoot = resolvePrimaryRoot(cwd)
  if (norm(wt) === norm(primaryRoot)) {
    return { code: 2, message: `refusing: ${wt} is the PRIMARY checkout, not a removable worktree` }
  }
  const registered = listWorktrees(cwd).map(norm)
  if (!registered.includes(norm(wt))) {
    return { code: 2, message: `refusing: ${wt} is not a registered worktree of this repository` }
  }

  const sharedNm = path.join(primaryRoot, 'node_modules')
  const before = count(sharedNm)
  const steps = []

  // node_modules first and ALWAYS, whatever any check would say about it.
  const nm = unlinkByEffect(path.join(wt, 'node_modules'))
  steps.push(nm.detail)
  if (nm.status === 'refused') return { code: 2, message: `refusing: ${nm.detail}`, steps }

  // Any other top-level link gets the same treatment (unlinkByEffect cannot delete real content).
  let entries = []
  try {
    entries = fs.readdirSync(wt)
  } catch {
    entries = []
  }
  for (const name of entries) {
    const p = path.join(wt, name)
    let isLink = false
    try {
      isLink = fs.lstatSync(p).isSymbolicLink()
    } catch {
      isLink = false
    }
    if (!isLink) continue
    const r = unlinkByEffect(p)
    steps.push(r.detail)
    if (r.status === 'refused') return { code: 2, message: `refusing: ${r.detail}`, steps }
  }

  const afterUnlink = count(sharedNm)
  if (before !== null && (afterUnlink === null || afterUnlink < before)) {
    return {
      code: 3,
      message: `ABORTED before git: shared ${sharedNm} went from ${before} to ${afterUnlink ?? 'unreadable'} entries while unlinking. Do NOT run git worktree remove; restore node_modules first.`,
      steps,
    }
  }

  try {
    removeWorktree(wt, Boolean(opts.force), cwd)
  } catch (e) {
    const stderr = e && e.stderr ? String(e.stderr).trim() : String(e)
    return { code: 1, message: `git worktree remove failed (links already unlinked, nothing deleted): ${stderr}`, steps }
  }

  const after = count(sharedNm)
  if (before !== null && (after === null || after < before)) {
    return {
      code: 3,
      message: `🛑 shared ${sharedNm} went from ${before} to ${after ?? 'unreadable'} entries during git worktree remove. Tell the other sessions; do not reinstall without asking.`,
      steps,
    }
  }
  steps.push(`git worktree remove ${wt}`)
  return { code: 0, message: `removed ${wt}; shared node_modules ${before ?? 'absent'} → ${after ?? 'absent'} entries`, steps }
}

function main(argv) {
  const args = argv.slice(2)
  const force = args.includes('--force')
  const targets = args.filter((a) => !a.startsWith('--'))
  if (targets.length !== 1) {
    console.error('usage: node scripts/safe-worktree-remove.mjs <worktree-path> [--force]')
    return 2
  }
  const result = safeWorktreeRemove({ worktree: targets[0], force })
  for (const s of result.steps ?? []) console.log(`  · ${s}`)
  ;(result.code === 0 ? console.log : console.error)(`[safe-worktree-remove] ${result.message}`)
  return result.code
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv)
}
