// @vitest-environment node
/**
 * The iOS app opens a tapped notification's screen only if `IosAppPushRegistrar` is mounted on
 * the page the app is showing. It lived in the /core shell, so a tap while the app was on a
 * league, player or Settings page did nothing (reported 2026-10-02). It must be mounted once,
 * in the root layout.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** JSX mounts only — `<IosAppPushRegistrar` at the start of a line, so a comment naming it is not a mount. */
const MOUNT = /^\s*<IosAppPushRegistrar\b/m

function filesMounting(): string[] {
  const out = execFileSync('git', ['grep', '-l', '<IosAppPushRegistrar', '--', 'app', 'components'], { encoding: 'utf8' })
  return out
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => MOUNT.test(readFileSync(f, 'utf8')))
}

describe('IosAppPushRegistrar mount', () => {
  it('is mounted in the root layout, so a tap works on every page', () => {
    expect(readFileSync('app/layout.tsx', 'utf8')).toMatch(MOUNT)
  })

  it('is mounted exactly once — two listeners would navigate and re-register twice', () => {
    expect(filesMounting()).toEqual(['app/layout.tsx'])
  })
})
