/**
 * The shared git-visible file enumeration, used by BOTH boundary guards.
 *
 * 🛑 EVERY CASE REPRODUCES A KNOWN POSITIVE BEFORE TRUSTING A NEGATIVE. This helper decides what
 * two guards are allowed to see, so a version that silently returns less is indistinguishable
 * from a clean tree — the exact failure both guards exist to prevent. The two assertions that
 * matter most are therefore the ones proving it does NOT over-narrow: a tracked file inside an
 * ignored directory is still returned, and an untracked-but-not-ignored file is still returned.
 *
 * ⚠ AND IT MUST RETURN null, NEVER [], WHEN GIT CANNOT ANSWER. The callers treat null as "fall
 * back to the filesystem walk" and an array as authoritative, so an empty array on failure would
 * turn a broken git into a silently empty scan.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listGitVisibleFiles } from '../../scripts/git-visible-files.mjs'

const TS = new Set(['.ts', '.tsx'])

describe('listGitVisibleFiles', () => {
  let repo: string

  const g = (args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { encoding: 'utf8', cwd: repo },
    ).trim()

  const write = (rel: string, body = 'export const x = 1\n') => {
    const abs = join(repo, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body)
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'af-git-visible-'))
    g(['init', '-q', '-b', 'main'])
    write('.gitignore', 'tmp-*\n.tmp-*\nbuilt/\n')
    write('lib/tracked.ts')
    write('lib/untracked.ts')
    write('.tmp-scratch/lib/ignored.ts')
    write('tmp-tracked/lib/forced.ts')
    write('built/generated.ts')
    write('lib/notsource.md', '# not a source file\n')
    g(['add', '.gitignore', 'lib/tracked.ts', 'lib/notsource.md'])
    g(['add', '-f', 'tmp-tracked/lib/forced.ts'])
    g(['commit', '-q', '-m', 'fixture'])
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  const list = () => listGitVisibleFiles(repo, { extensions: TS, label: 'test' })

  it('returns tracked files', () => {
    expect(list()).toContain('lib/tracked.ts')
  })

  it('returns untracked files that no ignore rule covers — it must not narrow to tracked-only', () => {
    // A brand-new file is exactly when a developer wants a guard to speak.
    expect(list()).toContain('lib/untracked.ts')
  })

  it('drops untracked files that are gitignored', () => {
    expect(list()).not.toContain('.tmp-scratch/lib/ignored.ts')
    expect(list()).not.toContain('built/generated.ts')
  })

  it('KEEPS a tracked file inside an ignored directory — an ignore rule does not beat --cached', () => {
    // 🛑 Otherwise committing a violation into `tmp-*/` would exempt it from both guards.
    expect(list()).toContain('tmp-tracked/lib/forced.ts')
  })

  it('filters by the caller-supplied extension set, which the two guards deliberately differ on', () => {
    expect(list()).not.toContain('lib/notsource.md')
    const wide = listGitVisibleFiles(repo, { extensions: new Set(['.md']), label: 'test' })
    expect(wide).toContain('lib/notsource.md')
    expect(wide).not.toContain('lib/tracked.ts')
  })

  it('returns null — NOT an empty array — when git cannot answer, so the caller falls back', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'af-git-visible-norepo-'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = listGitVisibleFiles(notARepo, { extensions: TS, label: 'my-guard' })
      expect(res).toBeNull()
      // The label is what tells a reader WHICH guard degraded.
      expect(warn.mock.calls.flat().join(' ')).toContain('my-guard')
    } finally {
      warn.mockRestore()
      rmSync(notARepo, { recursive: true, force: true })
    }
  })
})
