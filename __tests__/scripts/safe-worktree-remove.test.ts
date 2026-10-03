import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error — plain .mjs script, no type declarations
import { safeWorktreeRemove, unlinkByEffect } from '../../scripts/safe-worktree-remove.mjs'

/*
 * scripts/safe-worktree-remove.mjs exists because on 2026-10-01 two sessions emptied the SHARED
 * node_modules (every worktree junctions to it) while removing a worktree — both after a junction
 * check that wrongly said "no junction". These tests use REAL git worktrees and REAL links in a temp
 * dir; the control proves the hazard is real before the script is credited with preventing it.
 */

const git = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const count = (d: string) => {
  try {
    return fs.readdirSync(d).length
  } catch {
    return null
  }
}
const PACKAGES = ['next', 'react', 'vitest', 'typescript', 'prisma']

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saferm-'))
  const primary = path.join(root, 'primary')
  fs.mkdirSync(primary)
  git(['init', '-q', '-b', 'main'], primary)
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], primary)
  const shared = path.join(primary, 'node_modules')
  fs.mkdirSync(shared)
  for (const p of PACKAGES) {
    fs.mkdirSync(path.join(shared, p))
    fs.writeFileSync(path.join(shared, p, 'package.json'), '{}')
  }
  const wt = path.join(root, 'wt')
  git(['worktree', 'add', '-q', '--detach', wt], primary)
  return { primary, shared, wt, root }
}
// 'junction' on Windows; ignored on POSIX, where this makes a directory symlink.
const link = (wt: string, shared: string) => fs.symlinkSync(shared, path.join(wt, 'node_modules'), 'junction')

describe('safe-worktree-remove', () => {
  it.skipIf(process.platform !== 'win32')(
    'CONTROL: a plain `git worktree remove --force` deletes THROUGH the junction (the hazard is real)',
    () => {
      const f = fixture()
      link(f.wt, f.shared)
      try {
        git(['worktree', 'remove', '--force', f.wt], f.primary)
      } catch {
        // git may also complain; the shared folder is what this asserts on
      }
      expect(count(f.shared)).toBeLessThan(PACKAGES.length)
    },
  )

  it('removes a worktree whose node_modules links to the shared folder, leaving the shared folder intact', () => {
    const f = fixture()
    link(f.wt, f.shared)

    const r = safeWorktreeRemove({ worktree: f.wt, force: true, cwd: f.primary })

    expect(r.code).toBe(0)
    expect(count(f.shared)).toBe(PACKAGES.length)
    for (const p of PACKAGES) expect(fs.existsSync(path.join(f.shared, p, 'package.json'))).toBe(true)
    expect(fs.existsSync(f.wt)).toBe(false)
  })

  it('refuses a REAL non-empty node_modules and deletes nothing', () => {
    const f = fixture()
    fs.mkdirSync(path.join(f.wt, 'node_modules'))
    fs.writeFileSync(path.join(f.wt, 'node_modules', 'keep.txt'), 'x')

    const r = safeWorktreeRemove({ worktree: f.wt, force: true, cwd: f.primary })

    expect(r.code).toBe(2)
    expect(r.message).toMatch(/real, non-empty directory/)
    expect(fs.existsSync(path.join(f.wt, 'node_modules', 'keep.txt'))).toBe(true)
    expect(git(['worktree', 'list'], f.primary)).toContain('wt')
  })

  it('refuses the primary checkout and any path that is not a registered worktree', () => {
    const f = fixture()
    expect(safeWorktreeRemove({ worktree: f.primary, force: true, cwd: f.primary }).code).toBe(2)
    const stray = path.join(f.root, 'stray')
    fs.mkdirSync(stray)
    const r = safeWorktreeRemove({ worktree: stray, force: true, cwd: f.primary })
    expect(r.code).toBe(2)
    expect(r.message).toMatch(/not a registered worktree/)
    expect(count(f.shared)).toBe(PACKAGES.length)
  })

  it('ABORTS before calling git when the shared folder shrank while unlinking', () => {
    const f = fixture()
    link(f.wt, f.shared)
    const counts = [PACKAGES.length, 0] // before → after unlinking
    const removeWorktree = vi.fn()

    const r = safeWorktreeRemove({
      worktree: f.wt,
      cwd: f.primary,
      count: () => counts.shift() ?? 0,
      removeWorktree,
    })

    expect(r.code).toBe(3)
    expect(r.message).toMatch(/ABORTED before git/)
    expect(removeWorktree).not.toHaveBeenCalled()
  })

  it('unlinkByEffect never recurses: a link is removed, its target survives', () => {
    const f = fixture()
    link(f.wt, f.shared)
    expect(unlinkByEffect(path.join(f.wt, 'node_modules')).status).toBe('unlinked')
    expect(count(f.shared)).toBe(PACKAGES.length)
    expect(unlinkByEffect(path.join(f.wt, 'node_modules')).status).toBe('absent')
  })
})
