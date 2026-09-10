/**
 * `pre-push-smoke` must not be disabled by a stale link in the SHARED smoke worktree.
 *
 * WHAT HAPPENED (measured 2026-09-10)
 * `.git/af-smoke-worktree` is shared by every session on this checkout. One session junctioned
 * its `node_modules` there at its own scratchpad — `…/<session-id>/scratchpad/wt9/node_modules`
 * — and then ended. Its temp directory was cleaned up and the junction was left dangling.
 *
 * From that moment `ensureNodeModulesLink` did this, on every push, for every session:
 *
 *     existsSync(dest)   -> false    it resolves the TARGET, which was gone
 *     symlinkSync(dest)  -> EEXIST   it refuses the PATH, which was still there
 *
 * The early return never fired, the link was never made, and the smoke printed
 * "failing open, the push is allowed". Pushes to main landed with NO typecheck, and the only
 * symptom was a single warning line in output most callers filter away.
 *
 * ⚠ THE BUG IS THE SHAPE THIS REPO KEEPS PAYING FOR: a check that measures something adjacent
 * to what the guarded operation actually asks. `existsSync` answers "does the target resolve";
 * `symlinkSync` asks "is the path free". A dangling link is the one state where those disagree.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, lstatSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC = readFileSync(join(process.cwd(), 'scripts/pre-push-smoke.mjs'), 'utf8')

/**
 * SRC with block comments stripped.
 *
 * ⚠ A SOURCE-STRING GUARD CANNOT TELL CODE FROM PROSE ABOUT CODE, and this test caught itself
 * doing it: the fix's own doc comment names `rmSync(dest, { recursive: true })` as the form that
 * would delete through a live junction, and the negative assertion below matched that WARNING
 * rather than any real call. A guard that fires on the documentation of a hazard is a guard that
 * punishes explaining it.
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

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

describe('the platform fact the fix rests on', () => {
  /*
   * 🛑 A POSITIVE CONTROL FOR THE PREMISE, NOT FOR THE FIX. If Node ever stopped disagreeing
   * with itself here, the fix below would be guarding a state that cannot occur — and this test
   * is what would tell us, rather than the fix silently becoming dead code.
   */
  it('a dangling link reads as ABSENT to existsSync and PRESENT to lstatSync', () => {
    const root = mkdtempSync(join(tmpdir(), 'af-smoke-link-'))
    made.push(root)

    const target = join(root, 'target')
    const link = join(root, 'link')
    mkdirSync(target)
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')

    // Live: both agree it is there.
    expect(existsSync(link)).toBe(true)
    expect(() => lstatSync(link)).not.toThrow()

    // Now destroy the target, leaving the link entry behind — the production state.
    rmSync(target, { recursive: true, force: true })

    expect(existsSync(link)).toBe(false) // follows the link -> gone
    expect(lstatSync(link)).toBeTruthy() // does NOT follow -> the entry is still there

    // And this is the collision that disabled the guard.
    expect(() => symlinkSync(join(root, 'other'), link, 'junction')).toThrow(/EEXIST/)
  })
})

describe('ensureNodeModulesLink recovers instead of failing open', () => {
  it('probes with lstatSync, which is the call symlinkSync actually contradicts', () => {
    // The bare form is what shipped the outage: existsSync alone as the early return.
    expect(CODE).toMatch(/lstatSync\(dest\)/)
    expect(SRC).not.toMatch(/const dest = join\(worktreeDir, 'node_modules'\)\s*\n\s*if \(existsSync\(dest\)\) return null/)
  })

  it('still reuses a LIVE link rather than churning it every push', () => {
    // Re-creating the junction on each push would be wasted work and a new failure surface.
    expect(CODE).toMatch(/if \(existsSync\(dest\)\) return null/)
  })

  it('removes a stale link NON-recursively, so it can never delete through a live one', () => {
    /*
     * 🛑 THE DANGEROUS FIX. `rmSync(dest, { recursive: true })` on a live junction deletes
     * THROUGH it and takes the primary checkout's real node_modules — 696 entries — with it.
     * The removal must unlink the entry alone, and must be reachable only after existsSync has
     * already proven the target is gone.
     */
    expect(CODE).toMatch(/rmSync\(dest,\s*\{\s*recursive:\s*false/)
    expect(CODE).not.toMatch(/rmSync\(dest,\s*\{\s*recursive:\s*true/)
  })

  it('reports a stale link it cannot remove, rather than silently continuing', () => {
    expect(CODE).toMatch(/stale link and could not be removed/)
  })
})
