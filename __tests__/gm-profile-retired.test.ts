/**
 * Permanent regression guard for Phase 2B of
 * docs/DECISION_OS_MANAGER_DNA_DEDUP_AUDIT.md — retirement of the dead
 * `lib/gm-profile/` archetype classifier and its `POST /api/gm-profile` route.
 *
 * Both were confirmed to have zero live UI/programmatic consumers and zero
 * existing test coverage before deletion (see the audit doc §2, §7 step 1).
 * A golden-snapshot proof of the route's exact pre-deletion response shape
 * was captured and verified passing against the live code, then recorded in
 * the Phase 2B commit message, before this removal.
 *
 * This test exists to catch accidental re-introduction of either file rather
 * than to test any current behavior — there is no current behavior; the
 * module and route are gone.
 */
import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import path from 'path'

const REPO_ROOT = process.cwd()

describe('lib/gm-profile retirement (Phase 2B)', () => {
  it('the gm-profile engine module no longer exists', () => {
    expect(existsSync(path.join(REPO_ROOT, 'lib', 'gm-profile'))).toBe(false)
  })

  it('the /api/gm-profile route no longer exists', () => {
    expect(existsSync(path.join(REPO_ROOT, 'app', 'api', 'gm-profile'))).toBe(false)
  })

  it('dynamically importing the deleted route module rejects', async () => {
    const routeSpecifier = ['@', 'app', 'api', 'gm-profile', 'route'].join('/')
    await expect(import(/* @vite-ignore */ routeSpecifier)).rejects.toBeDefined()
  })

  it('dynamically importing the deleted engine module rejects', async () => {
    const engineSpecifier = ['@', 'lib', 'gm-profile'].join('/')
    await expect(import(/* @vite-ignore */ engineSpecifier)).rejects.toBeDefined()
  })
})
